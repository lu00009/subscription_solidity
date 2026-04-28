const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');
const { ethers } = require('ethers');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.PORT || 3003);
const MAX_TX_RECORDS = 500;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '';
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

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
      { internalType: 'uint8', name: 'tier', type: 'uint8' },
      { internalType: 'bool', name: 'isActive', type: 'bool' }
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
  }
];

const runtimeState = {
  provider: null,
  contract: null,
  chainId: null,
  startupError: null
};

const txStore = new Map();
const subscriberStats = {
  totalSubscribers: 0,
  activeSubscribers: 0,
  totalRevenue: '0'
};

function formatError(error) {
  if (!error) return 'Unknown error';
  return error.shortMessage || error.reason || error.message || String(error);
}

function normalizeStatus(status) {
  if (!status) return 'pending';
  const lowered = String(status).toLowerCase();
  if (['pending', 'confirmed', 'failed'].includes(lowered)) return lowered;
  return 'pending';
}

function makeTxKey(record) {
  return record.hash || record.clientId;
}

function cleanupTxStoreIfNeeded() {
  if (txStore.size <= MAX_TX_RECORDS) return;

  const sortedByUpdatedAt = Array.from(txStore.entries()).sort((a, b) => {
    return Number(new Date(a[1].updatedAt)) - Number(new Date(b[1].updatedAt));
  });

  const removeCount = txStore.size - MAX_TX_RECORDS;
  for (let i = 0; i < removeCount; i += 1) {
    txStore.delete(sortedByUpdatedAt[i][0]);
  }
}

function upsertTransaction(payload) {
  const key = makeTxKey(payload);
  const now = new Date().toISOString();

  if (!key) {
    throw new Error('Transaction payload requires hash or clientId');
  }

  const existing = txStore.get(key);
  const nextRecord = {
    id: existing?.id || payload.clientId || payload.hash,
    clientId: payload.clientId || existing?.clientId || null,
    hash: payload.hash || existing?.hash || null,
    address: payload.address || existing?.address || null,
    type: payload.type || existing?.type || 'Unknown',
    tier: payload.tier ?? existing?.tier ?? null,
    amount: payload.amount ?? existing?.amount ?? null,
    status: normalizeStatus(payload.status || existing?.status),
    error: payload.error ?? existing?.error ?? null,
    chainId: payload.chainId ?? existing?.chainId ?? runtimeState.chainId,
    blockNumber: payload.blockNumber ?? existing?.blockNumber ?? null,
    createdAt: existing?.createdAt || payload.timestamp || now,
    updatedAt: payload.timestamp || now
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

async function initializeContract() {
  runtimeState.startupError = null;

  if (!isContractConfigured()) {
    runtimeState.startupError = 'Invalid or missing CONTRACT_ADDRESS in environment';
    console.warn(runtimeState.startupError);
    return;
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const network = await provider.getNetwork();

    runtimeState.provider = provider;
    runtimeState.chainId = Number(network.chainId);
    runtimeState.contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, provider);

    console.log('Contract initialized successfully');
  } catch (error) {
    runtimeState.provider = null;
    runtimeState.contract = null;
    runtimeState.chainId = null;
    runtimeState.startupError = formatError(error);
    console.error('Failed to initialize contract:', runtimeState.startupError);
  }
}

function ensureContractReady(res) {
  if (!isContractReady()) {
    return res.status(503).json({
      error: 'Contract connection is not ready',
      details: runtimeState.startupError || 'Start local blockchain and deploy contract, then restart backend'
    });
  }

  return null;
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'subscription-backend',
    contractConfigured: isContractConfigured(),
    contractReady: isContractReady(),
    chainId: runtimeState.chainId,
    contractAddress: CONTRACT_ADDRESS || null,
    rpcUrl: RPC_URL,
    startupError: runtimeState.startupError,
    transactionRecords: txStore.size
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    contractAddress: CONTRACT_ADDRESS || null,
    rpcUrl: RPC_URL,
    chainId: runtimeState.chainId,
    contractReady: isContractReady()
  });
});

app.get('/api/transactions/:address', (req, res) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }

    const records = listTransactionsForAddress(address, req.query.limit);
    return res.json({ address, count: records.length, transactions: records });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch transactions', details: formatError(error) });
  }
});

app.post('/api/transactions', (req, res) => {
  try {
    const payload = req.body || {};

    if (!payload.hash && !payload.clientId) {
      return res.status(400).json({ error: 'hash or clientId is required' });
    }

    if (payload.address && !ethers.isAddress(payload.address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }

    const record = upsertTransaction(payload);
    return res.status(201).json({ message: 'Transaction recorded', transaction: record });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save transaction', details: formatError(error) });
  }
});

app.patch('/api/transactions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};

    const existing = txStore.get(id) || Array.from(txStore.values()).find((tx) => tx.clientId === id || tx.hash === id);

    if (!existing) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const mergedPayload = {
      ...existing,
      ...payload,
      hash: payload.hash || existing.hash,
      clientId: payload.clientId || existing.clientId || id,
      address: payload.address || existing.address,
      timestamp: new Date().toISOString()
    };

    const record = upsertTransaction(mergedPayload);

    if (id !== makeTxKey(record)) {
      txStore.delete(id);
    }

    return res.json({ message: 'Transaction updated', transaction: record });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update transaction', details: formatError(error) });
  }
});

app.get('/api/status/:address', async (req, res) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }

    const notReady = ensureContractReady(res);
    if (notReady) return;

    const details = await runtimeState.contract.getSubscriptionDetails(address);
    const tierPrices = await Promise.all([
      runtimeState.contract.tierPrices(0),
      runtimeState.contract.tierPrices(1)
    ]);

    const expiry = Number(details.expiry);
    const now = Math.floor(Date.now() / 1000);
    const isActive = details.isActive;

    // Update active subscribers count
    if (isActive) {
      subscriberStats.activeSubscribers = Math.max(subscriberStats.activeSubscribers, 1);
    }

    res.json({
      address,
      isActive,
      expiry: details.expiry.toString(),
      tier: Number(details.tier),
      expiryDate: expiry > 0 ? new Date(expiry * 1000).toISOString() : null,
      timeRemaining: expiry > 0 ? Math.max(0, expiry - now) : 0,
      tierPrices: {
        basic: ethers.formatEther(tierPrices[0]),
        premium: ethers.formatEther(tierPrices[1])
      }
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ error: 'Failed to fetch subscription status', details: formatError(error) });
  }
});

app.post('/api/reminder', async (req, res) => {
  try {
    const { addresses } = req.body;

    if (!Array.isArray(addresses)) {
      return res.status(400).json({ error: 'Addresses must be an array' });
    }

    const notReady = ensureContractReady(res);
    if (notReady) return;

    const expiringSubscriptions = [];
    const now = Math.floor(Date.now() / 1000);
    const oneWeekFromNow = now + 7 * 24 * 60 * 60;

    for (const address of addresses) {
      if (!ethers.isAddress(address)) continue;

      try {
        const details = await runtimeState.contract.getSubscriptionDetails(address);
        const expiry = Number(details.expiry);

        if (details.isActive && expiry <= oneWeekFromNow) {
          expiringSubscriptions.push({
            address,
            expiry: details.expiry.toString(),
            tier: Number(details.tier),
            expiryDate: new Date(expiry * 1000).toISOString(),
            daysUntilExpiry: Math.ceil((expiry - now) / (24 * 60 * 60))
          });
        }
      } catch (error) {
        console.error(`Error checking address ${address}:`, error);
      }
    }

    res.json({
      message: 'Reminder check completed',
      expiringSubscriptions,
      totalExpiring: expiringSubscriptions.length
    });
  } catch (error) {
    console.error('Error processing reminders:', error);
    res.status(500).json({ error: 'Failed to process reminders', details: formatError(error) });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const notReady = ensureContractReady(res);
    if (notReady) return;

    const tierPrices = await Promise.all([
      runtimeState.contract.tierPrices(0),
      runtimeState.contract.tierPrices(1)
    ]);

    // Calculate statistics from transaction store
    const uniqueSubscribers = new Set();
    let totalRevenue = ethers.getBigInt(0);
    
    txStore.forEach((tx) => {
      if (tx.status === 'confirmed' && tx.address) {
        uniqueSubscribers.add(tx.address.toLowerCase());
        
        // Parse revenue from amount field
        if (tx.amount && typeof tx.amount === 'string') {
          const match = tx.amount.match(/([0-9.]+)\s*ETH/i);
          if (match) {
            try {
              totalRevenue += ethers.parseEther(match[1]);
            } catch (e) {
              // Skip invalid amounts
            }
          }
        }
      }
    });

    subscriberStats.totalSubscribers = uniqueSubscribers.size;
    subscriberStats.totalRevenue = ethers.formatEther(totalRevenue);

    res.json({
      contractAddress: CONTRACT_ADDRESS,
      network: RPC_URL,
      chainId: runtimeState.chainId,
      tierPrices: {
        basic: ethers.formatEther(tierPrices[0]),
        premium: ethers.formatEther(tierPrices[1])
      },
      subscriptionDuration: '30 days',
      supportedTiers: ['Basic (0)', 'Premium (1)'],
      totalSubscribers: subscriberStats.totalSubscribers,
      activeSubscribers: subscriberStats.activeSubscribers,
      totalRevenue: subscriberStats.totalRevenue
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch contract stats', details: formatError(error) });
  }
});

cron.schedule('0 9 * * *', async () => {
  console.log('Running daily subscription expiry check...');
  console.log('Daily expiry check completed');
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!', details: formatError(err) });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

initializeContract().finally(() => {
  app.listen(PORT, () => {
    console.log(`Subscription DApp backend running on port ${PORT}`);
    console.log(`Contract address: ${CONTRACT_ADDRESS || '(not set)'}`);
    console.log(`RPC URL: ${RPC_URL}`);
  });
});

module.exports = app;
