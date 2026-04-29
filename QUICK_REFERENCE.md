# 🚀 Quick Reference Guide

## One-Page Cheat Sheet for Subscription DApp

### 🎯 Quick Start (3 Commands)

```bash
npm run setup          # Install all dependencies
npm run start:all      # Start blockchain + backend + frontend
# Open http://localhost:3000
```

### 📁 Project Structure

```
subscription-dapp/
├── contracts/         → Smart contracts (Solidity)
├── backend/          → API server (Express)
├── frontend/         → Web app (React)
├── scripts/          → Deployment scripts
└── test/             → Test files
```

### 🔧 Essential Commands

| Command | Description |
|---------|-------------|
| `npm run node` | Start local blockchain |
| `npm run deploy` | Deploy contract |
| `npm run backend` | Start API server |
| `npm run frontend` | Start web app |
| `npm test` | Run tests |
| `npm run compile` | Compile contracts |

### 🌐 URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3003 |
| Blockchain RPC | http://127.0.0.1:8545 |

### 🔑 MetaMask Setup

1. **Network Configuration**
   - Name: `Hardhat Local`
   - RPC: `http://127.0.0.1:8545`
   - Chain ID: `1337`
   - Symbol: `ETH`

2. **Import Account**
   - Copy private key from Hardhat terminal
   - MetaMask → Import Account → Paste

### 💰 Subscription Tiers

| Tier | Price | Duration | Features |
|------|-------|----------|----------|
| Basic | 0.01 ETH | 30 days | Standard features, email support |
| Premium | 0.025 ETH | 30 days | All features, priority support, analytics |

### 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/status/:address` | GET | Get subscription status |
| `/api/stats` | GET | Get statistics |
| `/api/balance` | GET | Get contract balance |
| `/api/transactions/:address` | GET | Get transactions |
| `/api/transactions` | POST | Create transaction |
| `/api/transactions/:id` | PATCH | Update transaction |
| `/api/reminder` | POST | Check expiring subscriptions |
| `/api/webhooks` | GET/POST | List or register webhook (admin) |
| `/api/webhooks/:id/test` | POST | Send manual webhook test (admin) |
| `/api/webhooks/logs` | GET | View webhook delivery logs (admin) |

### 🔐 Smart Contract Functions

#### User Functions
```solidity
subscribe(tier)        // Subscribe to tier (0=Basic, 1=Premium)
renew(tier)           // Renew subscription
unsubscribe()         // Cancel subscription
```

#### View Functions
```solidity
isActive(address)                    // Check if active
getSubscriptionDetails(address)      // Get full details
getDaysRemaining(address)            // Days left
isExpiringSoon(address)              // Expires within 7 days
```

#### Owner Functions
```solidity
withdraw()                           // Withdraw funds
updateTierPrice(tier, price)         // Update pricing
```

### 🎨 Frontend Features

- ✅ Wallet connection
- ✅ Subscribe/Renew/Cancel
- ✅ Real-time countdown
- ✅ Transaction history
- ✅ Search & filter
- ✅ Dark/Light theme
- ✅ Statistics dashboard
- ✅ Webhook management tab
- ✅ Webhook delivery logs panel

### 🧪 Testing

```bash
npm test                    # Run all tests
npm run test:coverage       # With coverage
npx hardhat test           # Direct Hardhat
```

### 📝 Environment Variables

#### Root `.env`
```env
CONTRACT_ADDRESS=0x...
REACT_APP_CONTRACT_ADDRESS=0x...
```

#### `backend/.env`
```env
PORT=3003
CONTRACT_ADDRESS=0x...
RPC_URL=http://127.0.0.1:8545
ADMIN_API_KEY=change_me_admin_key
WEBHOOK_SIGNING_SECRET=change_me_webhook_secret
WEBHOOK_TIMEOUT_MS=10000
WEBHOOK_MAX_ATTEMPTS=3
WEBHOOK_RETRY_BASE_MS=1500
```

#### `frontend/.env`
```env
REACT_APP_CONTRACT_ADDRESS=0x...
REACT_APP_NETWORK_ID=1337
REACT_APP_ADMIN_API_KEY=change_me_admin_key
```

### 🐛 Common Issues & Fixes

| Issue | Solution |
|-------|----------|
| Contract not ready | Start Hardhat node first |
| MetaMask won't connect | Check network is Chain ID 1337 |
| Transaction fails | Check sufficient ETH balance |
| Backend error | Verify contract address in .env |
| Frontend blank | Check backend is running |

### 📊 Key Metrics

- **Response Time:** <100ms (cached)
- **Cache TTL:** 30 seconds
- **Auto-refresh:** Every 20 seconds
- **Max Transactions:** 500 stored
- **Test Coverage:** 100% functions

### 🔄 Typical Workflow

1. **Setup**
   ```bash
   npm run setup
   ```

2. **Start Services**
   ```bash
   npm run start:all
   ```

3. **Configure MetaMask**
   - Add network (Chain ID 1337)
   - Import test account

4. **Use DApp**
   - Connect wallet
   - Subscribe to tier
   - View status
   - Manage subscription

5. **Development**
   - Edit code
   - Hot reload active
   - Test changes
   - Deploy updates

### 🚀 Deployment Checklist

#### Local
- [x] Start Hardhat node
- [x] Deploy contract
- [x] Start backend
- [x] Start frontend
- [x] Configure MetaMask

#### Testnet (Sepolia)
- [ ] Get Sepolia ETH
- [ ] Update .env with Infura URL
- [ ] Deploy: `npm run deploy:sepolia`
- [ ] Update frontend network ID
- [ ] Test on testnet

#### Production
- [ ] Security audit
- [ ] Deploy to mainnet
- [ ] Configure production backend
- [ ] Deploy frontend to hosting
- [ ] Set up monitoring

### 📚 Documentation Files

| File | Purpose |
|------|---------|
| `README.md` | Main documentation |
| `QUICK_START.md` | Quick setup guide |
| `DEPLOYMENT_GUIDE.md` | Complete deployment |
| `API_DOCUMENTATION.md` | API reference |
| `FEATURES.md` | Feature list |
| `ENHANCEMENTS_SUMMARY.md` | What's new |
| `QUICK_REFERENCE.md` | This file |

### 🎯 Quick Tips

1. **Always start Hardhat node first**
2. **Deploy contract before starting backend**
3. **Import test account to MetaMask**
4. **Check Chain ID is 1337**
5. **Keep terminals open while developing**
6. **Use `npm run start:all` for convenience**
7. **Check backend logs for errors**
8. **Clear cache if data seems stale**
9. **Refresh page if MetaMask disconnects**
10. **Read error messages carefully**

### 🔗 Useful Links

- **Hardhat Docs:** https://hardhat.org/docs
- **Ethers.js Docs:** https://docs.ethers.org/
- **React Docs:** https://react.dev/
- **OpenZeppelin:** https://docs.openzeppelin.com/
- **MetaMask:** https://docs.metamask.io/

### 📞 Getting Help

1. Check console for errors
2. Review documentation
3. Check troubleshooting section
4. Verify environment variables
5. Restart services
6. Clear cache and reload
7. Check GitHub issues
8. Create new issue with details

### ✅ Success Indicators

- ✅ No compilation errors
- ✅ All tests passing
- ✅ Backend shows "Contract initialized"
- ✅ Frontend loads without errors
- ✅ MetaMask connects successfully
- ✅ Transactions confirm quickly
- ✅ Data updates in real-time

### 🎉 You're Ready!

If you can:
- ✅ Connect MetaMask
- ✅ See your address
- ✅ Subscribe to a tier
- ✅ See countdown timer
- ✅ View transaction history

**Congratulations! Everything is working perfectly! 🚀**

---

**Quick Reference Version:** 1.0.0
**Last Updated:** January 2024
**Print this page for easy reference!**
