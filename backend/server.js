const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const cron    = require('node-cron');
const { ethers } = require('ethers');
const crypto  = require('crypto');
const http    = require('http');
const https   = require('https');
const path    = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app  = express();
const PORT = Number(process.env.PORT || 3003);
const MAX_TX_RECORDS = 500;
const MAX_WEBHOOK_RECORDS = 100;
const MAX_WEBHOOK_LOG_RECORDS = 2000;
const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS || 10_000);
const WEBHOOK_MAX_ATTEMPTS = Math.max(1, Number(process.env.WEBHOOK_MAX_ATTEMPTS || 3));
const WEBHOOK_RETRY_BASE_MS = Math.max(100, Number(process.env.WEBHOOK_RETRY_BASE_MS || 1500));
const DEFAULT_WEBHOOK_SECRET = process.env.WEBHOOK_SIGNING_SECRET || '';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '50kb' }));

// ─── Simple in-memory rate limiter ────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX       = 120;    // requests per window per IP

function rateLimit(req, res, next) {
  const ip  = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > entry.resetAt) {
    entry.count   = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  entry.count += 1;
  rateLimitMap.set(ip, entry);

  res.setHeader('X-RateLimit-Limit',     RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - entry.count));

  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  return next();
}

app.use(rateLimit);

// Periodically clean up old rate-limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60_000);

// ─── Config ────────────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '';
const RPC_URL          = process.env.RPC_URL || 'http://127.0.0.1:8545';

// ─── ABI ──────────────────────────────────────────────────────────────────────
const contractABI = [
  {
    inputs: [{ internalType: 'uint8', name: '_tier', type: 'uint8' }],
    name: 'subscribe',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'uint8', name: '_tier', type: 'uint8' }],
    name: 'renew',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'address', name: '_user', type: 'address' }],
    name: 'isActive',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'address', name: '_user', type: 'address' }],
    name: 'getExpiry',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'address', name: '_user', type: 'address' }],
    name: 'getTier',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'address', name: '_user', type: 'address' }],
    name: 'getSubscriptionDetails',
    outputs: [
      { internalType: 'uint256', name: 'expiry', type: 'uint256' },
      { internalType: 'uint8',   name: 'tier',   type: 'uint8' },
      { internalType: 'bool',    name: 'active', type: 'bool' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    name: 'tierPrices',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'getBalance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'user', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'expiry', type: 'uint256' },
      { indexed: false, internalType: 'uint8', name: 'tier', type: 'uint8' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'Subscribed',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'user', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'newExpiry', type: 'uint256' },
      { indexed: false, internalType: 'uint8', name: 'tier', type: 'uint8' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'Renewed',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, internalType: 'address', name: 'user', type: 'address' }],
    name: 'Unsubscribed',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'Withdrawn',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint8', name: 'tier', type: 'uint8' },
      { indexed: false, internalType: 'uint256', name: 'oldPrice', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'newPrice', type: 'uint256' }
    ],
    name: 'TierPriceUpdated',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'user', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'expiry', type: 'uint256' }
    ],
    name: 'SubscriptionExpired',
    type: 'event'
  }
];

// ─── Runtime state ─────────────────────────────────────────────────────────────
const runtimeState = {
  provider:     null,
  contract:     null,
  chainId:      null,
  startupError: null,
  listenersReady: false
};

// ─── In-memory transaction store ──────────────────────────────────────────────
const txStore = new Map();
const webhookStore = new Map();
const webhookLogStore = [];
const processedEventIds = new Set();
const SUPPORTED_WEBHOOK_EVENTS = new Set([
  'Subscribed',
  'Renewed',
  'Unsubscribed',
  'Withdrawn',
  'TierPriceUpdated',
  'SubscriptionExpired'
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatError(error) {
  if (!error) return 'Unknown error';
  return error.shortMessage || error.reason || error.message || String(error);
}

function normalizeStatus(status) {
  if (!status) return 'pending';
  const s = String(status).toLowerCase();
  return ['pending', 'confirmed', 'failed'].includes(s) ? s : 'pending';
}

function makeTxKey(record) {
  return record.hash || record.clientId;
}

function cleanupTxStoreIfNeeded() {
  if (txStore.size <= MAX_TX_RECORDS) return;
  const sorted = Array.from(txStore.entries())
    .sort((a, b) => Number(new Date(a[1].updatedAt)) - Number(new Date(b[1].updatedAt)));
  const removeCount = txStore.size - MAX_TX_RECORDS;
  for (let i = 0; i < removeCount; i++) txStore.delete(sorted[i][0]);
}

function upsertTransaction(payload) {
  const key = makeTxKey(payload);
  const now = new Date().toISOString();

  if (!key) throw new Error('Transaction payload requires hash or clientId');

  const existing   = txStore.get(key);
  const nextRecord = {
    id:          existing?.id || payload.clientId || payload.hash,
    clientId:    payload.clientId || existing?.clientId || null,
    hash:        payload.hash    || existing?.hash    || null,
    address:     payload.address || existing?.address || null,
    type:        payload.type    || existing?.type    || 'Unknown',
    tier:        payload.tier    ?? existing?.tier    ?? null,
    amount:      payload.amount  ?? existing?.amount  ?? null,
    status:      normalizeStatus(payload.status || existing?.status),
    error:       payload.error   ?? existing?.error   ?? null,
    chainId:     payload.chainId ?? existing?.chainId ?? runtimeState.chainId,
    blockNumber: payload.blockNumber ?? existing?.blockNumber ?? null,
    createdAt:   existing?.createdAt || payload.timestamp || now,
    updatedAt:   payload.timestamp || now
  };

  txStore.set(key, nextRecord);
  cleanupTxStoreIfNeeded();
  return nextRecord;
}

function listTransactionsForAddress(address, limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return Array.from(txStore.values())
    .filter((item) => item.address && item.address.toLowerCase() === address.toLowerCase())
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)))
    .slice(0, safeLimit);
}

function getSubscriptionActiveFlag(details) {
  if (!details) return false;
  if (typeof details.active === 'boolean') return details.active;
  if (typeof details.isActive === 'boolean') return details.isActive;
  return Boolean(details[2]);
}

function makeWebhookId() {
  return `wh_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function makeDeliveryLogId() {
  return `dlv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeWebhookEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return ['Subscribed', 'Renewed', 'Unsubscribed'];
  }
  const unique = Array.from(new Set(events.map((evt) => String(evt).trim())));
  const supported = unique.filter((evt) => SUPPORTED_WEBHOOK_EVENTS.has(evt));
  return supported.length > 0 ? supported : ['Subscribed', 'Renewed', 'Unsubscribed'];
}

function isAdminAuthorized(req) {
  if (!ADMIN_API_KEY) return true;
  return req.get('x-api-key') === ADMIN_API_KEY;
}

function requireAdmin(req, res, next) {
  if (!isAdminAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized. Missing or invalid x-api-key' });
  }
  return next();
}

function cleanupWebhookStoreIfNeeded() {
  if (webhookStore.size <= MAX_WEBHOOK_RECORDS) return;
  const sorted = Array.from(webhookStore.entries())
    .sort((a, b) => Number(new Date(a[1].createdAt)) - Number(new Date(b[1].createdAt)));
  const removeCount = webhookStore.size - MAX_WEBHOOK_RECORDS;
  for (let i = 0; i < removeCount; i++) webhookStore.delete(sorted[i][0]);
}

function addWebhookLog(log) {
  webhookLogStore.unshift(log);
  if (webhookLogStore.length > MAX_WEBHOOK_LOG_RECORDS) {
    webhookLogStore.length = MAX_WEBHOOK_LOG_RECORDS;
  }
}

function cleanupProcessedEvents() {
  if (processedEventIds.size <= 10_000) return;
  const keep = Array.from(processedEventIds).slice(-5_000);
  processedEventIds.clear();
  keep.forEach((id) => processedEventIds.add(id));
}

function signWebhookPayload(secret, timestamp, eventName, payloadText) {
  const signedData = `${timestamp}.${eventName}.${payloadText}`;
  return crypto.createHmac('sha256', secret).update(signedData).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJsonWebhook(url, payloadText, headers = {}, timeoutMs = WEBHOOK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_error) {
      reject(new Error('Invalid webhook URL'));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payloadText),
        ...headers
      }
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: responseBody
        });
      });
    });

    req.on('error', (error) => reject(error));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Webhook request timeout after ${timeoutMs}ms`));
    });
    req.write(payloadText);
    req.end();
  });
}

async function deliverWebhookWithRetry(webhook, eventName, eventId, payload) {
  const payloadText = JSON.stringify(payload);
  const signingSecret = webhook.secret || DEFAULT_WEBHOOK_SECRET || '';
  const attempts = [];
  let finalStatus = 'failed';
  let deliveredAt = null;

  for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt++) {
    const timestamp = String(Date.now());
    const signature = signingSecret ? signWebhookPayload(signingSecret, timestamp, eventName, payloadText) : null;
    const headers = {
      'x-webhook-id': webhook.id,
      'x-webhook-event': eventName,
      'x-webhook-event-id': eventId,
      'x-webhook-timestamp': timestamp
    };

    if (signature) {
      headers['x-webhook-signature'] = `sha256=${signature}`;
    }

    const startedAt = Date.now();

    try {
      const response = await sendJsonWebhook(webhook.url, payloadText, headers);
      const durationMs = Date.now() - startedAt;
      const isSuccess = response.statusCode >= 200 && response.statusCode < 300;

      attempts.push({
        attempt,
        status: isSuccess ? 'success' : 'failed',
        statusCode: response.statusCode,
        responseBody: response.body ? String(response.body).slice(0, 500) : '',
        error: null,
        durationMs,
        timestamp: new Date().toISOString()
      });

      if (isSuccess) {
        finalStatus = 'success';
        deliveredAt = new Date().toISOString();
        break;
      }
    } catch (error) {
      attempts.push({
        attempt,
        status: 'failed',
        statusCode: null,
        responseBody: '',
        error: formatError(error),
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString()
      });
    }

    if (attempt < WEBHOOK_MAX_ATTEMPTS) {
      const delayMs = WEBHOOK_RETRY_BASE_MS * (2 ** (attempt - 1));
      await sleep(delayMs);
    }
  }

  const logRecord = {
    id: makeDeliveryLogId(),
    webhookId: webhook.id,
    webhookUrl: webhook.url,
    eventName,
    eventId,
    status: finalStatus,
    deliveredAt,
    attempts,
    createdAt: new Date().toISOString()
  };

  addWebhookLog(logRecord);
  return logRecord;
}

async function dispatchContractEvent(eventName, payload, eventObject) {
  if (!eventObject || !eventObject.log) return;

  const txHash = eventObject.log.transactionHash || 'unknown';
  const logIndex = eventObject.log.index ?? eventObject.log.logIndex ?? '0';
  const eventId = `${txHash}:${logIndex}`;

  if (processedEventIds.has(eventId)) return;
  processedEventIds.add(eventId);
  cleanupProcessedEvents();

  const webhooks = Array.from(webhookStore.values()).filter((webhook) => (
    webhook.active && webhook.events.includes(eventName)
  ));

  if (webhooks.length === 0) return;

  const eventPayload = {
    id: eventId,
    event: eventName,
    chainId: runtimeState.chainId,
    contractAddress: CONTRACT_ADDRESS,
    blockNumber: eventObject.log.blockNumber || null,
    transactionHash: txHash,
    logIndex: Number(logIndex),
    emittedAt: new Date().toISOString(),
    data: payload
  };

  await Promise.all(webhooks.map((webhook) => deliverWebhookWithRetry(webhook, eventName, eventId, eventPayload)));
}

function isContractConfigured() {
  return Boolean(CONTRACT_ADDRESS && ethers.isAddress(CONTRACT_ADDRESS));
}

function isContractReady() {
  return Boolean(runtimeState.provider && runtimeState.contract && runtimeState.chainId !== null);
}

function ensureContractReady(res) {
  if (!isContractReady()) {
    res.status(503).json({
      error:   'Contract connection is not ready',
      details: runtimeState.startupError || 'Start local blockchain and deploy contract, then restart backend'
    });
    return true; // blocked
  }
  return false;
}

function attachContractEventListeners() {
  if (!runtimeState.contract || runtimeState.listenersReady) return;

  runtimeState.contract.removeAllListeners();

  runtimeState.contract.on('Subscribed', async (user, expiry, tier, amount, event) => {
    try {
      await dispatchContractEvent('Subscribed', {
        user,
        expiry: expiry.toString(),
        tier: Number(tier),
        amountWei: amount.toString(),
        amountEth: ethers.formatEther(amount)
      }, event);
    } catch (error) {
      console.error('[backend] Failed to dispatch Subscribed webhook:', formatError(error));
    }
  });

  runtimeState.contract.on('Renewed', async (user, newExpiry, tier, amount, event) => {
    try {
      await dispatchContractEvent('Renewed', {
        user,
        newExpiry: newExpiry.toString(),
        tier: Number(tier),
        amountWei: amount.toString(),
        amountEth: ethers.formatEther(amount)
      }, event);
    } catch (error) {
      console.error('[backend] Failed to dispatch Renewed webhook:', formatError(error));
    }
  });

  runtimeState.contract.on('Unsubscribed', async (user, event) => {
    try {
      await dispatchContractEvent('Unsubscribed', { user }, event);
    } catch (error) {
      console.error('[backend] Failed to dispatch Unsubscribed webhook:', formatError(error));
    }
  });

  runtimeState.contract.on('Withdrawn', async (owner, amount, event) => {
    try {
      await dispatchContractEvent('Withdrawn', {
        owner,
        amountWei: amount.toString(),
        amountEth: ethers.formatEther(amount)
      }, event);
    } catch (error) {
      console.error('[backend] Failed to dispatch Withdrawn webhook:', formatError(error));
    }
  });

  runtimeState.contract.on('TierPriceUpdated', async (tier, oldPrice, newPrice, event) => {
    try {
      await dispatchContractEvent('TierPriceUpdated', {
        tier: Number(tier),
        oldPriceWei: oldPrice.toString(),
        oldPriceEth: ethers.formatEther(oldPrice),
        newPriceWei: newPrice.toString(),
        newPriceEth: ethers.formatEther(newPrice)
      }, event);
    } catch (error) {
      console.error('[backend] Failed to dispatch TierPriceUpdated webhook:', formatError(error));
    }
  });

  runtimeState.contract.on('SubscriptionExpired', async (user, expiry, event) => {
    try {
      await dispatchContractEvent('SubscriptionExpired', {
        user,
        expiry: expiry.toString()
      }, event);
    } catch (error) {
      console.error('[backend] Failed to dispatch SubscriptionExpired webhook:', formatError(error));
    }
  });

  runtimeState.listenersReady = true;
  console.log('[backend] Contract event listeners attached');
}

// ─── Contract initialisation ──────────────────────────────────────────────────
async function initializeContract() {
  runtimeState.startupError = null;

  if (!isContractConfigured()) {
    runtimeState.startupError = 'Invalid or missing CONTRACT_ADDRESS in environment';
    console.warn('[backend]', runtimeState.startupError);
    return;
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const network  = await provider.getNetwork();

    runtimeState.provider = provider;
    runtimeState.chainId  = Number(network.chainId);
    runtimeState.contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, provider);
    runtimeState.listenersReady = false;
    attachContractEventListeners();

    console.log(`[backend] Contract initialised on chain ${runtimeState.chainId}`);
  } catch (error) {
    runtimeState.provider     = null;
    runtimeState.contract     = null;
    runtimeState.chainId      = null;
    runtimeState.listenersReady = false;
    runtimeState.startupError = formatError(error);
    console.error('[backend] Failed to initialise contract:', runtimeState.startupError);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status:              'OK',
    timestamp:           new Date().toISOString(),
    service:             'subscription-backend',
    contractConfigured:  isContractConfigured(),
    contractReady:       isContractReady(),
    chainId:             runtimeState.chainId,
    contractAddress:     CONTRACT_ADDRESS || null,
    rpcUrl:              RPC_URL,
    startupError:        runtimeState.startupError,
    transactionRecords:  txStore.size,
    webhookRecords:      webhookStore.size,
    webhookLogs:         webhookLogStore.length,
    listenersReady:      runtimeState.listenersReady
  });
});

// Config
app.get('/api/config', (_req, res) => {
  res.json({
    contractAddress: CONTRACT_ADDRESS || null,
    rpcUrl:          RPC_URL,
    chainId:         runtimeState.chainId,
    contractReady:   isContractReady()
  });
});

// Stats (enhanced with contract balance)
app.get('/api/stats', async (_req, res) => {
  if (ensureContractReady(res)) return;

  try {
    const [basicPrice, premiumPrice, contractBalanceWei] = await Promise.all([
      runtimeState.contract.tierPrices(0),
      runtimeState.contract.tierPrices(1),
      runtimeState.contract.getBalance().catch(() => BigInt(0))
    ]);

    // Count unique active subscribers from tx store
    const uniqueAddresses = new Set(
      Array.from(txStore.values())
        .filter((t) => t.status === 'confirmed' && t.type === 'Subscribe')
        .map((t) => t.address?.toLowerCase())
        .filter(Boolean)
    );

    res.json({
      contractAddress:    CONTRACT_ADDRESS,
      network:            RPC_URL,
      chainId:            runtimeState.chainId,
      tierPrices: {
        basic:   ethers.formatEther(basicPrice),
        premium: ethers.formatEther(premiumPrice)
      },
      contractBalance:    ethers.formatEther(contractBalanceWei),
      subscriptionDuration: '30 days',
      supportedTiers:     ['Basic (0)', 'Premium (1)'],
      totalTransactions:  txStore.size,
      uniqueSubscribers:  uniqueAddresses.size
    });
  } catch (error) {
    console.error('[backend] Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch contract stats', details: formatError(error) });
  }
});

// Contract balance
app.get('/api/balance', async (_req, res) => {
  if (ensureContractReady(res)) return;

  try {
    const balanceWei = await runtimeState.contract.getBalance();
    res.json({
      contractAddress: CONTRACT_ADDRESS,
      balanceWei:      balanceWei.toString(),
      balanceEth:      ethers.formatEther(balanceWei)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch contract balance', details: formatError(error) });
  }
});

// Subscription status for an address
app.get('/api/status/:address', async (req, res) => {
  const { address } = req.params;

  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Invalid Ethereum address' });
  }

  if (ensureContractReady(res)) return;

  try {
    const [details, tierPrices] = await Promise.all([
      runtimeState.contract.getSubscriptionDetails(address),
      Promise.all([
        runtimeState.contract.tierPrices(0),
        runtimeState.contract.tierPrices(1)
      ])
    ]);

    const expiry = Number(details.expiry);
    const now    = Math.floor(Date.now() / 1000);
    const active = getSubscriptionActiveFlag(details);

    return res.json({
      address,
      isActive:      active,
      expiry:        details.expiry.toString(),
      tier:          Number(details.tier),
      expiryDate:    expiry > 0 ? new Date(expiry * 1000).toISOString() : null,
      timeRemaining: expiry > 0 ? Math.max(0, expiry - now) : 0,
      tierPrices: {
        basic:   ethers.formatEther(tierPrices[0]),
        premium: ethers.formatEther(tierPrices[1])
      }
    });
  } catch (error) {
    console.error('[backend] Error fetching subscription status:', error);
    return res.status(500).json({ error: 'Failed to fetch subscription status', details: formatError(error) });
  }
});

// List transactions for an address
app.get('/api/transactions/:address', (req, res) => {
  const { address } = req.params;

  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Invalid Ethereum address' });
  }

  try {
    const records = listTransactionsForAddress(address, req.query.limit);
    return res.json({ address, count: records.length, transactions: records });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch transactions', details: formatError(error) });
  }
});

// Create / upsert transaction
app.post('/api/transactions', (req, res) => {
  const payload = req.body || {};

  if (!payload.hash && !payload.clientId) {
    return res.status(400).json({ error: 'hash or clientId is required' });
  }

  if (payload.address && !ethers.isAddress(payload.address)) {
    return res.status(400).json({ error: 'Invalid Ethereum address' });
  }

  try {
    const record = upsertTransaction(payload);
    return res.status(201).json({ message: 'Transaction recorded', transaction: record });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save transaction', details: formatError(error) });
  }
});

// Update transaction
app.patch('/api/transactions/:id', (req, res) => {
  const { id }    = req.params;
  const payload   = req.body || {};
  const existing  = txStore.get(id) ||
    Array.from(txStore.values()).find((tx) => tx.clientId === id || tx.hash === id);

  if (!existing) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  try {
    const mergedPayload = {
      ...existing,
      ...payload,
      hash:      payload.hash      || existing.hash,
      clientId:  payload.clientId  || existing.clientId || id,
      address:   payload.address   || existing.address,
      timestamp: new Date().toISOString()
    };

    const record = upsertTransaction(mergedPayload);
    if (id !== makeTxKey(record)) txStore.delete(id);

    return res.json({ message: 'Transaction updated', transaction: record });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update transaction', details: formatError(error) });
  }
});

// Webhook system summary
app.get('/api/webhooks/summary', requireAdmin, (_req, res) => {
  const webhooks = Array.from(webhookStore.values());
  const active = webhooks.filter((w) => w.active).length;
  const recentLogs = webhookLogStore.slice(0, 100);
  const successful = recentLogs.filter((log) => log.status === 'success').length;
  const failed = recentLogs.filter((log) => log.status === 'failed').length;

  res.json({
    totalWebhooks: webhooks.length,
    activeWebhooks: active,
    supportedEvents: Array.from(SUPPORTED_WEBHOOK_EVENTS),
    recentDelivery: {
      checked: recentLogs.length,
      success: successful,
      failed
    }
  });
});

// Register webhook endpoint
app.post('/api/webhooks', requireAdmin, (req, res) => {
  const { url, events, secret, description } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Webhook url must use http or https' });
    }

    const record = {
      id: makeWebhookId(),
      url,
      events: normalizeWebhookEvents(events),
      secret: typeof secret === 'string' ? secret : '',
      description: typeof description === 'string' ? description : '',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    webhookStore.set(record.id, record);
    cleanupWebhookStoreIfNeeded();
    return res.status(201).json({ message: 'Webhook registered', webhook: record });
  } catch (_error) {
    return res.status(400).json({ error: 'Invalid webhook url' });
  }
});

// List registered webhooks
app.get('/api/webhooks', requireAdmin, (_req, res) => {
  const hooks = Array.from(webhookStore.values())
    .sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
  res.json({ count: hooks.length, webhooks: hooks });
});

// Update webhook
app.patch('/api/webhooks/:id', requireAdmin, (req, res) => {
  const existing = webhookStore.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Webhook not found' });
  }

  const { url, events, secret, description, active } = req.body || {};
  let nextUrl = existing.url;

  if (typeof url === 'string' && url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'Webhook url must use http or https' });
      }
      nextUrl = url;
    } catch (_error) {
      return res.status(400).json({ error: 'Invalid webhook url' });
    }
  }

  const updated = {
    ...existing,
    url: nextUrl,
    events: Array.isArray(events) ? normalizeWebhookEvents(events) : existing.events,
    secret: typeof secret === 'string' ? secret : existing.secret,
    description: typeof description === 'string' ? description : existing.description,
    active: typeof active === 'boolean' ? active : existing.active,
    updatedAt: new Date().toISOString()
  };

  webhookStore.set(updated.id, updated);
  return res.json({ message: 'Webhook updated', webhook: updated });
});

// Delete webhook
app.delete('/api/webhooks/:id', requireAdmin, (req, res) => {
  const existed = webhookStore.delete(req.params.id);
  if (!existed) {
    return res.status(404).json({ error: 'Webhook not found' });
  }
  return res.json({ message: 'Webhook deleted' });
});

// Manually test webhook delivery
app.post('/api/webhooks/:id/test', requireAdmin, async (req, res) => {
  const webhook = webhookStore.get(req.params.id);
  if (!webhook) {
    return res.status(404).json({ error: 'Webhook not found' });
  }

  const eventId = `manual-test-${Date.now()}`;
  const payload = {
    id: eventId,
    event: 'ManualTest',
    chainId: runtimeState.chainId,
    contractAddress: CONTRACT_ADDRESS || null,
    blockNumber: null,
    transactionHash: null,
    logIndex: null,
    emittedAt: new Date().toISOString(),
    data: {
      message: 'Manual webhook test from subscription-backend'
    }
  };

  try {
    const delivery = await deliverWebhookWithRetry(webhook, 'ManualTest', eventId, payload);
    return res.json({ message: 'Test delivery completed', delivery });
  } catch (error) {
    return res.status(500).json({ error: 'Test delivery failed', details: formatError(error) });
  }
});

// Webhook delivery logs
app.get('/api/webhooks/logs', requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const webhookId = req.query.webhookId ? String(req.query.webhookId) : null;
  const status = req.query.status ? String(req.query.status).toLowerCase() : null;

  const logs = webhookLogStore
    .filter((log) => !webhookId || log.webhookId === webhookId)
    .filter((log) => !status || log.status === status)
    .slice(0, limit);

  res.json({ count: logs.length, logs });
});

// Expiry reminder check
app.post('/api/reminder', async (req, res) => {
  const { addresses } = req.body;

  if (!Array.isArray(addresses)) {
    return res.status(400).json({ error: 'addresses must be an array' });
  }

  if (ensureContractReady(res)) return;

  const expiringSubscriptions = [];
  const now            = Math.floor(Date.now() / 1000);
  const oneWeekFromNow = now + 7 * 86400;

  for (const address of addresses) {
    if (!ethers.isAddress(address)) continue;
    try {
      const details = await runtimeState.contract.getSubscriptionDetails(address);
      const expiry  = Number(details.expiry);
      if (getSubscriptionActiveFlag(details) && expiry <= oneWeekFromNow) {
        expiringSubscriptions.push({
          address,
          expiry:          details.expiry.toString(),
          tier:            Number(details.tier),
          expiryDate:      new Date(expiry * 1000).toISOString(),
          daysUntilExpiry: Math.ceil((expiry - now) / 86400)
        });
      }
    } catch (err) {
      console.error(`[backend] Error checking address ${address}:`, err);
    }
  }

  return res.json({
    message:               'Reminder check completed',
    expiringSubscriptions,
    totalExpiring:         expiringSubscriptions.length
  });
});

// ─── Cron: daily expiry check ─────────────────────────────────────────────────
cron.schedule('0 9 * * *', () => {
  console.log('[cron] Running daily subscription expiry check…');
  // Extend here: send emails, push notifications, etc.
  console.log('[cron] Daily expiry check completed');
});

// ─── Error handlers ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[backend] Unhandled error:', err.stack);
  res.status(500).json({ error: 'Internal server error', details: formatError(err) });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
initializeContract().finally(() => {
  app.listen(PORT, () => {
    console.log(`[backend] Subscription DApp backend running on port ${PORT}`);
    console.log(`[backend] Contract address : ${CONTRACT_ADDRESS || '(not set)'}`);
    console.log(`[backend] RPC URL          : ${RPC_URL}`);
  });
});

module.exports = app;
