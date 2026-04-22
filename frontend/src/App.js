import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';
import './App.css';

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
    "inputs": [],
    "name": "unsubscribe",
    "outputs": [],
    "stateMutability": "nonpayable",
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

function App() {
  const [account, setAccount] = useState(null);
  const [contract, setContract] = useState(null);
  const [provider, setProvider] = useState(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tierPrices, setTierPrices] = useState({ basic: '0.01', premium: '0.025' });
  const [countdown, setCountdown] = useState(null);
  const [showUnsubscribeConfirm, setShowUnsubscribeConfirm] = useState(false);

  const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS;

  useEffect(() => {
    if (window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum);
      setProvider(provider);
    }

    // Load contract address from environment or backend
    loadContractInfo();
  }, []);

  useEffect(() => {
    if (account && contract) {
      fetchSubscriptionStatus();
    }
  }, [account, contract]);

  useEffect(() => {
    let interval;
    if (subscriptionStatus && subscriptionStatus.isActive) {
      interval = setInterval(() => {
        updateCountdown();
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [subscriptionStatus]);

  const loadContractInfo = async () => {
    try {
      const response = await axios.get('/api/stats');
      if (response.data.contractAddress) {
        setTierPrices(response.data.tierPrices);
      }
    } catch (error) {
      console.error('Failed to load contract info:', error);
    }
  };

  const connectWallet = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!window.ethereum) {
        throw new Error('MetaMask is not installed');
      }

      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      const contractInstance = new ethers.Contract(
        CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3', // Fallback address for localhost
        contractABI,
        signer
      );

      setAccount(accounts[0]);
      setContract(contractInstance);
      setProvider(provider);

      // Load tier prices from contract
      const basicPrice = await contractInstance.tierPrices(0);
      const premiumPrice = await contractInstance.tierPrices(1);
      setTierPrices({
        basic: ethers.formatEther(basicPrice),
        premium: ethers.formatEther(premiumPrice)
      });

    } catch (error) {
      console.error('Error connecting wallet:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubscriptionStatus = async () => {
    if (!contract || !account) return;

    try {
      const details = await contract.getSubscriptionDetails(account);
      
      setSubscriptionStatus({
        isActive: details.isActive,
        expiry: details.expiry.toString(),
        tier: Number(details.tier),
        expiryDate: new Date(Number(details.expiry) * 1000).toLocaleString()
      });

      updateCountdown();
    } catch (error) {
      console.error('Error fetching subscription status:', error);
      // Set default status even on error
      setSubscriptionStatus({
        isActive: false,
        expiry: '0',
        tier: 0,
        expiryDate: 'No subscription'
      });
    }
  };

  const updateCountdown = () => {
    if (!subscriptionStatus || !subscriptionStatus.isActive) return;

    const now = Math.floor(Date.now() / 1000);
    const expiry = Number(subscriptionStatus.expiry);
    const timeLeft = expiry - now;

    if (timeLeft > 0) {
      const days = Math.floor(timeLeft / (24 * 60 * 60));
      const hours = Math.floor((timeLeft % (24 * 60 * 60)) / (60 * 60));
      const minutes = Math.floor((timeLeft % (60 * 60)) / 60);
      const seconds = timeLeft % 60;

      setCountdown(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    } else {
      setCountdown('Expired');
      setSubscriptionStatus(prev => ({ ...prev, isActive: false }));
    }
  };

  const handleSubscribe = async (tier) => {
    if (!contract) return;

    try {
      setLoading(true);
      setError(null);

      const price = tier === 0 ? tierPrices.basic : tierPrices.premium;
      const tx = await contract.subscribe(tier, {
        value: ethers.parseEther(price)
      });

      await tx.wait();
      await fetchSubscriptionStatus();

    } catch (error) {
      console.error('Error subscribing:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRenew = async (tier) => {
    if (!contract) return;

    try {
      setLoading(true);
      setError(null);

      const price = tier === 0 ? tierPrices.basic : tierPrices.premium;
      const tx = await contract.renew(tier, {
        value: ethers.parseEther(price)
      });

      await tx.wait();
      await fetchSubscriptionStatus();

    } catch (error) {
      console.error('Error renewing:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    if (!contract) return;

    try {
      setLoading(true);
      setError(null);

      const tx = await contract.unsubscribe();
      await tx.wait();
      await fetchSubscriptionStatus();

    } catch (error) {
      console.error('Error unsubscribing:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const getTierName = (tier) => {
    return tier === 0 ? 'Basic' : 'Premium';
  };

  return (
    <div className="min-h-screen p-4 bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      <div className="max-w-6xl mx-auto">
        {/* Animated Background Elements */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-2000"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-indigo-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-4000"></div>
        </div>
        
        <header className="text-center mb-12 relative z-10">
          <div className="inline-flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <h1 className="text-5xl font-bold text-white mb-3 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
            Subscription DApp
          </h1>
          <p className="text-xl text-gray-300">Premium subscription management powered by Ethereum</p>
          <div className="mt-6 flex justify-center space-x-4">
            <div className="px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full border border-white/20">
              <span className="text-sm text-gray-300">Network: </span>
              <span className="text-sm font-semibold text-white">Localhost</span>
            </div>
            <div className="px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full border border-white/20">
              <span className="text-sm text-gray-300">Status: </span>
              <span className="text-sm font-semibold text-green-400">Active</span>
            </div>
          </div>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-6 py-4 rounded-xl mb-6 backdrop-blur-sm">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">{error}</span>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6 mb-8">
          {/* Wallet Connection Card */}
          <div className="card lg:col-span-1">
            <div className="flex items-center mb-6">
              <div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl flex items-center justify-center mr-4">
                <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Wallet</h2>
                <p className="text-sm text-gray-500">Connect your MetaMask</p>
              </div>
            </div>
            
            {!account ? (
              <button
                onClick={connectWallet}
                disabled={loading}
                className="wallet-connect-btn w-full flex items-center justify-center"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Connecting...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.5 6L12 10.5 8.5 8 11 5.5 12 6.5l1-1L15.5 8zM12 13.5L8.5 17 11 19.5l1-1 1 1L15.5 17 12 13.5z"/>
                    </svg>
                    Connect MetaMask
                  </>
                )}
              </button>
            ) : (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center mb-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                    <span className="text-sm font-semibold text-green-800">Connected</span>
                  </div>
                  <p className="text-xs text-gray-600 mb-2">Account Address:</p>
                  <p className="font-mono text-xs bg-gray-100 p-3 rounded border break-all">
                    {account}
                  </p>
                </div>
                <button
                  onClick={connectWallet}
                  className="w-full py-3 px-4 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition duration-200 flex items-center justify-center"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh Connection
                </button>
              </div>
            )}
          </div>

          {/* Subscription Status Card */}
          <div className="card lg:col-span-2">
            <div className="flex items-center mb-6">
              <div className="w-12 h-12 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl flex items-center justify-center mr-4">
                <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Subscription Status</h2>
                <p className="text-sm text-gray-500">Your current subscription details</p>
              </div>
            </div>
            
            {!account ? (
              <div className="text-center py-12">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-gray-500 text-lg">Connect wallet to check status</p>
                <p className="text-gray-400 text-sm mt-2">Your subscription details will appear here</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <div className="mb-6">
                    <span className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold ${
                      (subscriptionStatus && subscriptionStatus.isActive) 
                        ? 'bg-green-100 text-green-800 border border-green-200' 
                        : 'bg-red-100 text-red-800 border border-red-200'
                    }`}>
                      <div className={`w-2 h-2 rounded-full mr-2 ${
                        (subscriptionStatus && subscriptionStatus.isActive) ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                      }`}></div>
                      {(subscriptionStatus && subscriptionStatus.isActive) ? 'Active Subscription' : 'No Active Subscription'}
                    </span>
                  </div>

                  {subscriptionStatus && subscriptionStatus.isActive && (
                    <div className="space-y-4">
                      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-600">Current Tier</span>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            subscriptionStatus.tier === 1 
                              ? 'bg-purple-100 text-purple-800' 
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {getTierName(subscriptionStatus.tier)}
                          </span>
                        </div>
                      </div>
                      
                      <div className="bg-gray-50 rounded-lg p-4">
                        <p className="text-sm font-medium text-gray-600 mb-1">Expires On</p>
                        <p className="text-lg font-semibold text-gray-800">
                          {subscriptionStatus.expiryDate}
                        </p>
                      </div>
                      
                      <button
                        onClick={() => setShowUnsubscribeConfirm(true)}
                        disabled={loading}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-lg transition duration-200 flex items-center justify-center"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Unsubscribe
                      </button>
                    </div>
                  )}
                </div>
                
                <div>
                  {subscriptionStatus && subscriptionStatus.isActive && countdown && (
                    <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-6 text-white">
                      <div className="flex items-center mb-4">
                        <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="font-semibold">Time Remaining</span>
                      </div>
                      <div className="text-3xl font-bold mb-2">
                        {countdown}
                      </div>
                      <div className="w-full bg-white/20 rounded-full h-2">
                        <div className="bg-white rounded-full h-2 w-3/4 animate-pulse"></div>
                      </div>
                    </div>
                  )}
                  
                  {!subscriptionStatus || !subscriptionStatus.isActive && (
                    <div className="text-center py-8">
                      <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-gray-500 font-medium">No active subscription</p>
                      <p className="text-gray-400 text-sm mt-2">Choose a plan below to get started</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Subscription Plans */}
        {account && (
          <div className="card">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-800 mb-2">Choose Your Plan</h2>
              <p className="text-gray-500">Select the perfect subscription tier for your needs</p>
            </div>
            
            <div className="grid md:grid-cols-2 gap-8">
              {/* Basic Plan */}
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl opacity-75 group-hover:opacity-100 blur transition duration-300"></div>
                <div className="relative bg-white rounded-xl p-8 border border-gray-200">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-2xl font-bold text-gray-800">Basic</h3>
                      <p className="text-gray-500">Perfect for getting started</p>
                    </div>
                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                      </svg>
                    </div>
                  </div>
                  
                  <div className="mb-6">
                    <span className="text-4xl font-bold text-gray-900">{tierPrices.basic}</span>
                    <span className="text-gray-500 ml-2">ETH</span>
                    <p className="text-sm text-gray-500 mt-1">per 30 days</p>
                  </div>
                  
                  <ul className="space-y-3 mb-8">
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">30 days full access</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Essential features</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Email support</span>
                    </li>
                  </ul>
                  
                  {!subscriptionStatus?.isActive ? (
                    <button
                      onClick={() => handleSubscribe(0)}
                      disabled={loading}
                      className="subscribe-btn w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700"
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Processing...
                        </>
                      ) : (
                        'Subscribe Basic'
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRenew(0)}
                      disabled={loading}
                      className="renew-btn w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600"
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Processing...
                        </>
                      ) : (
                        'Renew Basic'
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Premium Plan */}
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl opacity-75 group-hover:opacity-100 blur transition duration-300"></div>
                <div className="relative bg-white rounded-xl p-8 border-2 border-purple-200">
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-1 rounded-full text-sm font-semibold">
                      MOST POPULAR
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mb-6 mt-2">
                    <div>
                      <h3 className="text-2xl font-bold text-gray-800">Premium</h3>
                      <p className="text-gray-500">Unlock all features</p>
                    </div>
                    <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-purple-600" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                      </svg>
                    </div>
                  </div>
                  
                  <div className="mb-6">
                    <span className="text-4xl font-bold text-gray-900">{tierPrices.premium}</span>
                    <span className="text-gray-500 ml-2">ETH</span>
                    <p className="text-sm text-gray-500 mt-1">per 30 days</p>
                  </div>
                  
                  <ul className="space-y-3 mb-8">
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Everything in Basic</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Priority support</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Exclusive content</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Advanced analytics</span>
                    </li>
                  </ul>
                  
                  {!subscriptionStatus?.isActive ? (
                    <button
                      onClick={() => handleSubscribe(1)}
                      disabled={loading}
                      className="subscribe-btn w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Processing...
                        </>
                      ) : (
                        'Subscribe Premium'
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRenew(1)}
                      disabled={loading}
                      className="renew-btn w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Processing...
                        </>
                      ) : (
                        'Renew Premium'
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {loading && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-8 max-w-sm mx-4 shadow-2xl">
              <div className="loading-spinner mx-auto mb-6"></div>
              <h3 className="text-xl font-semibold text-center mb-2">Processing Transaction</h3>
              <p className="text-gray-600 text-center mb-4">Please confirm the transaction in MetaMask</p>
              <div className="flex justify-center">
                <div className="flex space-x-2">
                  <div className="w-3 h-3 bg-blue-600 rounded-full animate-bounce"></div>
                  <div className="w-3 h-3 bg-blue-600 rounded-full animate-bounce animation-delay-200"></div>
                  <div className="w-3 h-3 bg-blue-600 rounded-full animate-bounce animation-delay-400"></div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Unsubscribe Confirmation Dialog */}
        {showUnsubscribeConfirm && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-8 max-w-md mx-4 shadow-2xl">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Unsubscribe Confirmation</h3>
                <p className="text-gray-600 mb-4">
                  Are you sure you want to unsubscribe? You will lose access to all premium features immediately.
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-red-800">
                    <strong>Warning:</strong> This action cannot be undone. You'll need to purchase a new subscription to regain access.
                  </p>
                </div>
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowUnsubscribeConfirm(false)}
                  className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-lg transition duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowUnsubscribeConfirm(false);
                    handleUnsubscribe();
                  }}
                  disabled={loading}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition duration-200 flex items-center justify-center"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Unsubscribing...
                    </>
                  ) : (
                    'Yes, Unsubscribe'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Footer */}
        <footer className="text-center py-8 mt-12 relative z-10">
          <div className="flex justify-center items-center space-x-6 text-gray-400">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              <span className="text-sm">Built with Solidity</span>
            </div>
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              <span className="text-sm">Powered by Ethereum</span>
            </div>
          </div>
          <p className="text-gray-500 text-sm mt-4">© 2024 Subscription DApp. All rights reserved.</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
