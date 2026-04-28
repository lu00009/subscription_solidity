# Subscription Payment DApp

A full-stack decentralized application for managing subscription payments using Ethereum, Solidity, Hardhat, Node.js, and React.

## 🚀 Features

### Smart Contract
- **Subscription Management**: Users can subscribe to Basic or Premium tiers
- **Duration**: 30-day subscription periods
- **Security**: Uses OpenZeppelin's Ownable and ReentrancyGuard
- **Events**: Emits Subscribed and Renewed events
- **Tier System**: Basic (0.01 ETH) and Premium (0.025 ETH) tiers

### Backend API
- **RESTful Endpoints**: Express.js server with comprehensive API
- **Contract Integration**: Reads data from smart contract using ethers.js
- **Status Checking**: Get subscription status for any address
- **Reminder System**: Endpoint to check for expiring subscriptions
- **Cron Jobs**: Daily expiry checks (placeholder implementation)

### Frontend
- **Modern UI**: React with Tailwind CSS styling
- **Wallet Integration**: MetaMask connection and transaction handling
- **Real-time Updates**: Live countdown timer for subscription expiry
- **Responsive Design**: Mobile-friendly interface
- **Error Handling**: Comprehensive error states and user feedback

## 📁 Project Structure

```
subscription-dapp/
├── contracts/
│   └── SubscriptionService.sol      # Main smart contract
├── scripts/
│   └── deploy.js                    # Deployment script
├── test/
│   └── SubscriptionService.test.js  # Comprehensive test suite
├── backend/
│   ├── server.js                    # Express API server
│   └── package.json                 # Backend dependencies
├── frontend/
│   ├── src/
│   │   ├── App.js                   # Main React component
│   │   ├── App.css                  # Tailwind CSS styles
│   │   └── index.js                 # React entry point
│   ├── public/
│   │   └── index.html               # HTML template
│   └── package.json                 # Frontend dependencies
├── hardhat.config.js                # Hardhat configuration
├── package.json                     # Root dependencies
└── README.md                        # This file
```

## 🛠️ Tech Stack

- **Smart Contract**: Solidity ^0.8.20
- **Development Framework**: Hardhat
- **Backend**: Node.js + Express.js
- **Frontend**: React 18 + Ethers.js
- **Styling**: Tailwind CSS
- **Testing**: Mocha + Chai
- **Security**: OpenZeppelin Contracts

## 📋 Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- MetaMask browser extension
- Git

## 🚀 Setup Instructions

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd subscription_solidity

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

### 2. Environment Configuration

```bash
# Copy environment templates
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Edit .env files with your configuration
```

### 3. Compile and Deploy Smart Contract

```bash
# Compile contracts
npm run compile

# Start local Hardhat network (in separate terminal)
npm run node

# Deploy contract (in another terminal)
npm run deploy
```

The deployment script will automatically update these files with the contract address:
- `.env`
- `backend/.env`
- `frontend/.env`

### 4. Run the Application

#### Option A: Run All Services Concurrently

```bash
npm run dev
```

#### Option B: Run Services Separately

```bash
# Terminal 1: Start Hardhat node
npm run node

# Terminal 2: Start backend server
npm run backend

# Terminal 3: Start frontend
npm run frontend
```

### 5. Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3003
- **Hardhat Network**: http://localhost:8545

## 🧪 Testing

### Smart Contract Tests

```bash
# Run all tests
npm test

# Run specific test file
npx hardhat test test/SubscriptionService.test.js
```

### Test Coverage

The test suite covers:
- Contract deployment and initialization
- Subscription functionality (Basic and Premium tiers)
- Renewal process
- Access control and security
- Edge cases and error conditions
- Multiple user scenarios

## 📚 API Endpoints

### GET `/api/health`
Returns server health status.

### GET `/api/status/:address`
Get subscription status for a specific Ethereum address.

**Response:**
```json
{
  "address": "0x...",
  "isActive": true,
  "expiry": "1699123456",
  "tier": 1,
  "expiryDate": "2023-11-04T12:34:56.000Z",
  "timeRemaining": 86400,
  "tierPrices": {
    "basic": "0.01",
    "premium": "0.025"
  }
}
```

### POST `/api/reminder`
Check for expiring subscriptions.

**Request:**
```json
{
  "addresses": ["0x...", "0x..."]
}
```

### GET `/api/stats`
Get contract statistics and configuration.

## 🔧 Configuration

### Environment Variables

#### Root `.env`
```
CONTRACT_ADDRESS=deployed_contract_address
REACT_APP_CONTRACT_ADDRESS=deployed_contract_address
PRIVATE_KEY=your_private_key_here
SEPOLIA_URL=https://sepolia.infura.io/v3/your_infura_project_id
ETHERSCAN_API_KEY=your_etherscan_api_key
```

#### Backend `backend/.env`
```
PORT=3003
CONTRACT_ADDRESS=deployed_contract_address
RPC_URL=http://127.0.0.1:8545
```

#### Frontend `frontend/.env`
```
REACT_APP_CONTRACT_ADDRESS=deployed_contract_address
REACT_APP_NETWORK_ID=1337
```

## 🎯 Usage Guide

### For Users

1. **Install MetaMask**: Add the MetaMask extension to your browser
2. **Connect Wallet**: Click "Connect MetaMask" in the application
3. **Choose Plan**: Select Basic or Premium subscription tier
4. **Pay with ETH**: Confirm the transaction in MetaMask
5. **Track Subscription**: View your subscription status and expiry time
6. **Renew**: Extend your subscription before it expires

### For Developers

1. **Smart Contract**: Located in `contracts/SubscriptionService.sol`
2. **Backend API**: Express server in `backend/server.js`
3. **Frontend**: React app in `frontend/src/App.js`
4. **Testing**: Comprehensive test suite in `test/`

## 🔒 Security Features

- **Reentrancy Protection**: Uses OpenZeppelin's ReentrancyGuard
- **Access Control**: Owner-only functions with Ownable
- **Input Validation**: Proper validation of all inputs
- **Error Handling**: Custom errors with descriptive messages
- **Event Logging**: Comprehensive event emission for tracking

## 🚀 Deployment

### Local Deployment

Follow the setup instructions above for local development.

### Testnet Deployment

1. Update `.env` with your Sepolia testnet configuration
2. Deploy to Sepolia:
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

### Production Deployment

For production deployment:
1. Audit the smart contract
2. Deploy to mainnet
3. Configure production backend
4. Deploy frontend to hosting service
5. Set up monitoring and logging

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Troubleshooting

### Common Issues

**MetaMask Connection Issues**
- Ensure MetaMask is installed and unlocked
- Check that you're on the correct network (localhost:8545 for development)
- Refresh the page and try reconnecting

**Contract Deployment Issues**
- Ensure Hardhat node is running: `npm run node`
- Check your .env configuration
- Verify you have sufficient test ETH

**Backend Connection Issues**
- Ensure backend server is running on port 3003
- Check that contract address is correctly set in .env
- Verify RPC URL is accessible

**Frontend Issues**
- Clear browser cache and localStorage
- Check browser console for errors
- Ensure all dependencies are installed

### Getting Help

- Check the console for error messages
- Review the test files for usage examples
- Ensure all environment variables are properly set
- Verify network connectivity and configuration

## 📈 Advanced Features

The DApp includes several advanced features:

1. **Subscription Tiers**: Basic and Premium plans with different pricing
2. **Countdown Timer**: Real-time countdown showing subscription expiry
3. **Modern UI**: Responsive design with Tailwind CSS
4. **Error Handling**: Comprehensive error states and user feedback
5. **Event Tracking**: Smart contract events for subscription tracking
6. **API Integration**: RESTful backend for external integrations

## 🎉 Conclusion

This Subscription DApp demonstrates a complete full-stack blockchain application with modern web development practices. It includes smart contract development, backend API integration, and a polished frontend user interface.

The project is designed to be educational while maintaining production-quality code standards and security best practices.
