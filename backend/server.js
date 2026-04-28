const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const cron    = require('node-cron');
const { ethers } = require('ethers');
const path    = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app  = express();
const PORT = Number(process.env.PORT || 3003);
const MAX_TX_RECORDS = 500;

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
      { internalType: 'bool',    name: 'isActive', type: 'bool' }
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
  }
];

// ─── Runtime state ─────────────────────────────────────────────────────────────
const runtimeState = {
  provider:     null,
  contract:     null,
  chainId:      null,
  startupError: null
};

// ─── In-memory transaction store ──────────────────────────────────────────────
const txStore = new Map();

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

    console.log(`[backend] Contract initialised on chain ${runtimeState.chainId}`);
  } catch (error) {
    runtimeState.provider     = null;
    runtimeState.contract     = null;
    runtimeState.chainId      = null;
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
    transactionRecords:  txStore.size
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

    return res.json({
      address,
      isActive:      details.isActive,
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
      if (details.isActive && expiry <= oneWeekFromNow) {
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
