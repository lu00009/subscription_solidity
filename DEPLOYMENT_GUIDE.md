# Subscription DApp - Deployment & Setup Guide

## 🚀 Complete Setup Instructions

### Prerequisites

- Node.js v16+ and npm/pnpm
- MetaMask browser extension
- Git

### 1. Initial Setup

```bash
# Clone and install dependencies
git clone <your-repo-url>
cd subscription-dapp

# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install
cd ..

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### 2. Start Local Blockchain

Open a terminal and run:

```bash
npm run node
```

This starts a Hardhat local blockchain on `http://127.0.0.1:8545` (Chain ID: 1337).

**Important:** Keep this terminal running throughout development.

### 3. Deploy Smart Contract

Open a new terminal and run:

```bash
npm run deploy
```

This will:
- Compile the Solidity contract
- Deploy to local blockchain
- Automatically update `.env` files with contract address
- Display initial contract state

**Output Example:**
```
SubscriptionService deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3
Basic tier price: 0.01 ETH
Premium tier price: 0.025 ETH
```

### 4. Configure MetaMask

1. Open MetaMask
2. Add Local Network:
   - Network Name: `Hardhat Local`
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `1337`
   - Currency Symbol: `ETH`

3. Import Test Account:
   - Copy private key from Hardhat node terminal
   - MetaMask → Import Account → Paste private key
   - You'll have 10,000 test ETH

### 5. Start Backend Server

Open a new terminal:

```bash
cd backend
npm start
```

Backend runs on `http://localhost:3003`

**Features:**
- Real-time blockchain event listening
- Transaction tracking
- Subscription caching (30s TTL)
- Statistics aggregation
- Automatic expiry checks (daily at 9 AM)

### 6. Start Frontend

Open a new terminal:

```bash
cd frontend
npm start
```

Frontend runs on `http://localhost:3000`

### 7. Using the DApp

1. **Connect Wallet**
   - Click "Connect MetaMask"
   - Approve connection in MetaMask
   - Ensure you're on Chain ID 1337

2. **Subscribe**
   - Choose Basic (0.01 ETH) or Premium (0.025 ETH)
   - Click Subscribe button
   - Confirm transaction in MetaMask
   - Wait for confirmation

3. **View Status**
   - See active subscription status
   - View countdown timer
   - Check transaction history

4. **Renew Subscription**
   - Click Renew button (appears when active)
   - Choose tier (can upgrade/downgrade)
   - Confirm transaction

5. **Unsubscribe**
   - Click "Cancel Subscription"
   - Confirm in modal
   - Approve transaction

## 🔧 Environment Variables

### Root `.env`
```env
CONTRACT_ADDRESS=<deployed-contract-address>
REACT_APP_CONTRACT_ADDRESS=<deployed-contract-address>
```

### `backend/.env`
```env
PORT=3003
CONTRACT_ADDRESS=<deployed-contract-address>
RPC_URL=http://127.0.0.1:8545
ADMIN_API_KEY=<strong-admin-key>
WEBHOOK_SIGNING_SECRET=<strong-signing-secret>
WEBHOOK_TIMEOUT_MS=10000
WEBHOOK_MAX_ATTEMPTS=3
WEBHOOK_RETRY_BASE_MS=1500
```

### `frontend/.env`
```env
REACT_APP_CONTRACT_ADDRESS=<deployed-contract-address>
REACT_APP_NETWORK_ID=1337
REACT_APP_ADMIN_API_KEY=<same-admin-key-if-needed>
```

## 📡 API Endpoints

### Health Check
```bash
GET /api/health
```

### Get Subscription Status
```bash
GET /api/status/:address
```

### Get Statistics
```bash
GET /api/stats
```

### Get Contract Balance
```bash
GET /api/balance
```

### Get Transactions
```bash
GET /api/transactions/:address?limit=20
```

### Create Transaction
```bash
POST /api/transactions
Body: { hash, address, type, tier, amount, status }
```

### Update Transaction
```bash
PATCH /api/transactions/:id
Body: { status, error, blockNumber }
```

### Check Expiring Subscriptions
```bash
POST /api/reminder
Body: { addresses: ["0x..."] }
```

### Webhooks (Admin)
```bash
GET /api/webhooks/summary
POST /api/webhooks
GET /api/webhooks
PATCH /api/webhooks/:id
DELETE /api/webhooks/:id
POST /api/webhooks/:id/test
GET /api/webhooks/logs?limit=50
```

## 🧪 Testing

### Run Smart Contract Tests
```bash
npm test
```

### Test Coverage
```bash
npx hardhat coverage
```

### Manual Testing Checklist

- [ ] Connect wallet successfully
- [ ] Subscribe with Basic tier
- [ ] Subscribe with Premium tier
- [ ] View active subscription status
- [ ] Countdown timer updates
- [ ] Renew subscription
- [ ] Upgrade from Basic to Premium
- [ ] Downgrade from Premium to Basic
- [ ] Unsubscribe
- [ ] Transaction history displays correctly
- [ ] Filter transactions by status
- [ ] Search transactions
- [ ] Backend stats update
- [ ] Theme toggle works
- [ ] Network mismatch warning appears
- [ ] Error handling works

## 🐛 Troubleshooting

### Contract Not Ready
**Problem:** Backend shows "Contract connection is not ready"

**Solutions:**
1. Ensure Hardhat node is running
2. Check `CONTRACT_ADDRESS` in `backend/.env`
3. Verify RPC URL is correct
4. Restart backend server

### MetaMask Connection Failed
**Problem:** Can't connect wallet

**Solutions:**
1. Check MetaMask is installed
2. Verify network is Chain ID 1337
3. Clear MetaMask activity data
4. Refresh page

### Transaction Failed
**Problem:** Transaction reverts or fails

**Solutions:**
1. Check sufficient ETH balance
2. Verify correct tier price
3. Ensure not already subscribed (for subscribe)
4. Check subscription is active (for renew/unsubscribe)

### Frontend Not Loading Data
**Problem:** Dashboard shows loading state forever

**Solutions:**
1. Check backend is running on port 3003
2. Verify CORS is enabled
3. Check browser console for errors
4. Clear browser cache

## 📊 Smart Contract Details

### Subscription Tiers
- **Basic (0):** 0.01 ETH / 30 days
- **Premium (1):** 0.025 ETH / 30 days

### Key Functions
- `subscribe(tier)` - Create new subscription
- `renew(tier)` - Extend existing subscription
- `unsubscribe()` - Cancel subscription
- `getSubscriptionDetails(address)` - View subscription info
- `isActive(address)` - Check if subscription is active
- `withdraw()` - Owner withdraws contract balance (owner only)
- `updateTierPrice(tier, price)` - Update tier pricing (owner only)

### Events
- `Subscribed(user, expiry, tier, amount)`
- `Renewed(user, newExpiry, tier, amount)`
- `Unsubscribed(user)`
- `Withdrawn(owner, amount)`
- `TierPriceUpdated(tier, oldPrice, newPrice)`

## 🔐 Security Features

- ReentrancyGuard on all state-changing functions
- Ownable access control
- Custom error messages
- Input validation
- Excess payment refunds
- Safe math operations (Solidity 0.8+)

## 🚀 Production Deployment

### Deploy to Testnet (Sepolia)

1. Get Sepolia ETH from faucet
2. Update `hardhat.config.js` with your private key
3. Deploy:
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

4. Update environment variables with new contract address
5. Update frontend `REACT_APP_NETWORK_ID` to `11155111`

### Deploy Backend

- Use services like Heroku, Railway, or AWS
- Set environment variables
- Ensure RPC URL points to Infura/Alchemy

### Deploy Frontend

- Build: `cd frontend && npm run build`
- Deploy to Vercel, Netlify, or AWS S3
- Update environment variables

## 📈 Monitoring

### Backend Logs
- Event listener activity
- Transaction processing
- Cache operations
- Daily expiry checks
- Statistics updates

### Frontend Monitoring
- Transaction status updates
- Auto-refresh every 20 seconds
- Real-time countdown
- Error notifications

## 🎯 Future Enhancements

- [ ] Email notifications for expiring subscriptions
- [ ] Multi-tier pricing with more options
- [ ] Subscription gifting
- [ ] Referral system
- [ ] Admin dashboard
- [ ] Payment in ERC-20 tokens
- [ ] Subscription NFTs
- [ ] Discount codes
- [ ] Bulk subscription management

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Open pull request

## 📧 Support

For issues and questions:
- Open GitHub issue
- Check existing documentation
- Review troubleshooting section
