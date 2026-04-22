const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');
const { ethers } = require('ethers');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Contract configuration
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

// Contract ABI (simplified version with only needed functions)
const contractABI = [
  {
    "inputs": [{"internalType": "uint8", "name": "_tier", "type": "uint8"}],
    "name": "subscribe",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint8", "name": "_tier", "type": "uint8"}],
    "name": "renew",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "_user", "type": "address"}],
    "name": "isActive",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "_user", "type": "address"}],
    "name": "getExpiry",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "_user", "type": "address"}],
    "name": "getTier",
    "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "_user", "type": "address"}],
    "name": "getSubscriptionDetails",
    "outputs": [
      {"internalType": "uint256", "name": "expiry", "type": "uint256"},
      {"internalType": "uint8", "name": "tier", "type": "uint8"},
      {"internalType": "bool", "name": "isActive", "type": "bool"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
    "name": "tierPrices",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
];

// Initialize provider and contract
let provider;
let contract;

function initializeContract() {
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, provider);
    console.log('Contract initialized successfully');
  } catch (error) {
    console.error('Failed to initialize contract:', error);
  }
}

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/status/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }

    if (!contract) {
      return res.status(500).json({ error: 'Contract not initialized' });
    }

    const details = await contract.getSubscriptionDetails(address);
    const tierPrices = await Promise.all([
      contract.tierPrices(0),
      contract.tierPrices(1)
    ]);

    const response = {
      address,
      isActive: details.isActive,
      expiry: details.expiry.toString(),
      tier: details.tier,
      expiryDate: details.expiry > 0 ? new Date(Number(details.expiry) * 1000).toISOString() : null,
      timeRemaining: details.expiry > 0 ? Math.max(0, Number(details.expiry) - Math.floor(Date.now() / 1000)) : 0,
      tierPrices: {
        basic: ethers.formatEther(tierPrices[0]),
        premium: ethers.formatEther(tierPrices[1])
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

app.post('/api/reminder', async (req, res) => {
  try {
    const { addresses } = req.body;
    
    if (!Array.isArray(addresses)) {
      return res.status(400).json({ error: 'Addresses must be an array' });
    }

    if (!contract) {
      return res.status(500).json({ error: 'Contract not initialized' });
    }

    const expiringSubscriptions = [];
    const now = Math.floor(Date.now() / 1000);
    const oneWeekFromNow = now + (7 * 24 * 60 * 60); // 7 days from now

    for (const address of addresses) {
      if (!ethers.isAddress(address)) continue;

      try {
        const details = await contract.getSubscriptionDetails(address);
        
        if (details.isActive && Number(details.expiry) <= oneWeekFromNow) {
          expiringSubscriptions.push({
            address,
            expiry: details.expiry.toString(),
            tier: details.tier,
            expiryDate: new Date(Number(details.expiry) * 1000).toISOString(),
            daysUntilExpiry: Math.ceil((Number(details.expiry) - now) / (24 * 60 * 60))
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
    res.status(500).json({ error: 'Failed to process reminders' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    if (!contract) {
      return res.status(500).json({ error: 'Contract not initialized' });
    }

    const tierPrices = await Promise.all([
      contract.tierPrices(0),
      contract.tierPrices(1)
    ]);

    const stats = {
      contractAddress: CONTRACT_ADDRESS,
      network: RPC_URL,
      tierPrices: {
        basic: ethers.formatEther(tierPrices[0]),
        premium: ethers.formatEther(tierPrices[1])
      },
      subscriptionDuration: '30 days',
      supportedTiers: ['Basic (0)', 'Premium (1)']
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch contract stats' });
  }
});

// Cron job to check for expiring subscriptions (runs daily at 9 AM)
cron.schedule('0 9 * * *', async () => {
  console.log('Running daily subscription expiry check...');
  
  // This is a placeholder - in a real implementation, you might:
  // 1. Fetch all active subscribers from a database
  // 2. Check their subscription status
  // 3. Send email/push notifications for expiring subscriptions
  
  console.log('Daily expiry check completed');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize contract and start server
initializeContract();

app.listen(PORT, () => {
  console.log(`Subscription DApp backend running on port ${PORT}`);
  console.log(`Contract address: ${CONTRACT_ADDRESS}`);
  console.log(`RPC URL: ${RPC_URL}`);
});

module.exports = app;
