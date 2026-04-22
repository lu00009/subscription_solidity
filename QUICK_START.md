# Quick Start Guide

Get your Subscription DApp running in 5 minutes!

## 🚀 One-Command Setup

```bash
# Install all dependencies and run everything
npm install && npm run dev
```

## 📋 Step-by-Step Instructions

### 1. Install Dependencies

```bash
# Root dependencies
npm install

# Backend dependencies
cd backend && npm install && cd ..

# Frontend dependencies  
cd frontend && npm install && cd ..
```

### 2. Start Local Blockchain

```bash
# Start Hardhat local network (keeps running)
npm run node
```

### 3. Deploy Contract

```bash
# In a new terminal, deploy the contract
npm run deploy
```

### 4. Start Backend API

```bash
# In a new terminal
npm run backend
```

### 5. Start Frontend

```bash
# In a new terminal
npm run frontend
```

## 🌐 Access Points

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Blockchain**: http://localhost:8545

## 🦊 MetaMask Setup

1. Install MetaMask browser extension
2. Add Localhost Network:
   - Network Name: localhost
   - RPC URL: http://127.0.0.1:8545
   - Chain ID: 1337
   - Currency Symbol: ETH
3. Import test account (use first account from Hardhat output)

## 🧪 Run Tests

```bash
# Test smart contract
npm test
```

## 🎯 First Usage

1. Open http://localhost:3000
2. Click "Connect MetaMask"
3. Choose Basic (0.01 ETH) or Premium (0.025 ETH)
4. Approve transaction in MetaMask
5. View your subscription status!

## 🔧 Commands Reference

```bash
npm run compile    # Compile smart contracts
npm run test       # Run tests
npm run node       # Start local blockchain
npm run deploy     # Deploy contract
npm run backend    # Start backend server
npm run frontend   # Start frontend app
npm run dev        # Run all services
```

## ⚠️ Troubleshooting

**"MetaMask not installed"** → Install MetaMask extension

**"Contract not found"** → Run `npm run deploy` first

**"Connection refused"** → Make sure all services are running in separate terminals

**"Insufficient funds"** → Import test account from Hardhat node output
