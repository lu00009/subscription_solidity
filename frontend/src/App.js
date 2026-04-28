import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';
import './App.css';

const FALLBACK_LOCAL_CONTRACT = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const EXPECTED_CHAIN_ID = Number(process.env.REACT_APP_NETWORK_ID || 1337);
const TX_HISTORY_STORAGE_KEY = 'subscription_dapp_tx_history';
const THEME_STORAGE_KEY = 'subscription_dapp_theme';

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
    inputs: [],
    name: 'unsubscribe',
    outputs: [],
    stateMutability: 'nonpayable',
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

const api = axios.create({ timeout: 5000 });
const preciseDateTimeFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});
const preciseTimeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});
const timeZoneLabel = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local Time';

function formatPreciseDateTime(value) {
  if (!value) return 'Not yet';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet';
  return preciseDateTimeFormat.format(date);
}

function formatPreciseTime(value) {
  if (!value) return '--:--:--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return preciseTimeFormat.format(date);
}

function formatCountdown(expiry) {
  const now = Math.floor(Date.now() / 1000);
  const timeLeft = Number(expiry) - now;

  if (timeLeft <= 0) return 'Expired';

  const days = Math.floor(timeLeft / (24 * 60 * 60));
  const hours = Math.floor((timeLeft % (24 * 60 * 60)) / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function getErrorMessage(error) {
  if (!error) return 'Unknown error';

  return (
    error.shortMessage ||
    error.reason ||
    error?.response?.data?.details ||
    error?.response?.data?.error ||
    error.message ||
    'Unexpected error'
  );
}

function shortenAddress(address) {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getTierLabel(tier) {
  return Number(tier) === 1 ? 'Premium' : 'Basic';
}

function toTxKey(tx) {
  if (!tx) return null;
  return tx.hash || tx.clientId || tx.id || null;
}

function mergeTxRecords(primaryList = [], secondaryList = []) {
  const map = new Map();

  [...secondaryList, ...primaryList].forEach((item) => {
    const key = toTxKey(item);
    if (!key) return;
    map.set(key, item);
  });

  return Array.from(map.values())
    .sort((a, b) => Number(new Date(b.timestamp || b.updatedAt || 0)) - Number(new Date(a.timestamp || a.updatedAt || 0)))
    .slice(0, 20);
}

function getInitialTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === 'light' ? 'light' : 'dark';
}

function getInitialTxHistory() {
  try {
    const raw = localStorage.getItem(TX_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function App() {
  const [contract, setContract] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [initialLoadPending, setInitialLoadPending] = useState(true);
  const [txSyncing, setTxSyncing] = useState(false);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(false);

  const [theme, setTheme] = useState(getInitialTheme);
  const [transactions, setTransactions] = useState(getInitialTxHistory);

  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [showUnsubscribeConfirm, setShowUnsubscribeConfirm] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [tierPrices, setTierPrices] = useState({ basic: '0.01', premium: '0.025' });
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [stats, setStats] = useState({ totalSubscribers: 0, activeSubscribers: 0, revenue: '0' });
  const [showStatsPanel, setShowStatsPanel] = useState(false);
  const [txFilter, setTxFilter] = useState('all'); // all, confirmed, pending, failed
  const [txSearch, setTxSearch] = useState('');

  const [backend, setBackend] = useState({
    online: false,
    contractReady: false,
    chainId: null,
    contractAddress: process.env.REACT_APP_CONTRACT_ADDRESS || FALLBACK_LOCAL_CONTRACT,
    startupError: null
  });

  const filteredTransactions = useMemo(() => {
    let filtered = transactions;

    // Filter by status
    if (txFilter !== 'all') {
      filtered = filtered.filter(tx => tx.status === txFilter);
    }

    // Filter by search term
    if (txSearch.trim()) {
      const searchLower = txSearch.toLowerCase();
      filtered = filtered.filter(tx => 
        tx.type?.toLowerCase().includes(searchLower) ||
        tx.hash?.toLowerCase().includes(searchLower) ||
        tx.tier?.toLowerCase().includes(searchLower) ||
        tx.amount?.toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  }, [transactions, txFilter, txSearch]);

  const walletAvailable = typeof window !== 'undefined' && Boolean(window.ethereum);
  const networkMatches = chainId === null ? true : Number(chainId) === EXPECTED_CHAIN_ID;

  const effectiveContractAddress = useMemo(() => {
    return backend.contractAddress || process.env.REACT_APP_CONTRACT_ADDRESS || FALLBACK_LOCAL_CONTRACT;
  }, [backend.contractAddress]);

  const backendStatusText = useMemo(() => {
    if (!backend.online) return 'Offline';
    if (!backend.contractReady) return 'Online / Initializing Contract';
    return 'Online / Ready';
  }, [backend.online, backend.contractReady]);

  const themeBackground = theme === 'dark'
    ? 'bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950'
    : 'bg-gradient-to-br from-amber-50 via-sky-100 to-orange-100';

  const titleText = theme === 'dark' ? 'text-white' : 'text-slate-900';
  const subtitleText = theme === 'dark' ? 'text-slate-200' : 'text-slate-700';

  const appendTx = (item) => {
    setTransactions((prev) => mergeTxRecords([item], prev));
  };

  const updateTx = (idOrHash, patch) => {
    setTransactions((prev) => {
      return prev.map((tx) => {
        const matched = tx.id === idOrHash || tx.hash === idOrHash || tx.clientId === idOrHash;
        return matched ? { ...tx, ...patch } : tx;
      });
    });
  };

  const buildSignerContract = async (nextProvider) => {
    const signer = await nextProvider.getSigner();
    return new ethers.Contract(effectiveContractAddress, contractABI, signer);
  };

  const loadBackendInfo = async (showLoader = false) => {
    try {
      if (showLoader) setRefreshing(true);

      const [healthResponse, statsResponse] = await Promise.allSettled([
        api.get('/api/health'),
        api.get('/api/stats')
      ]);

      if (healthResponse.status === 'fulfilled') {
        const payload = healthResponse.value.data;
        setBackend((prev) => ({
          ...prev,
          online: true,
          contractReady: Boolean(payload.contractReady),
          chainId: payload.chainId,
          startupError: payload.startupError || null,
          contractAddress: payload.contractAddress || prev.contractAddress
        }));
      } else {
        setBackend((prev) => ({
          ...prev,
          online: false,
          contractReady: false,
          startupError: getErrorMessage(healthResponse.reason)
        }));
      }

      if (statsResponse.status === 'fulfilled') {
        const payload = statsResponse.value.data;
        setTierPrices((prev) => payload.tierPrices || prev);
        setStats({
          totalSubscribers: payload.totalSubscribers || 0,
          activeSubscribers: payload.activeSubscribers || 0,
          revenue: payload.totalRevenue || '0'
        });
        setBackend((prev) => ({
          ...prev,
          contractAddress: payload.contractAddress || prev.contractAddress,
          chainId: payload.chainId ?? prev.chainId,
          contractReady: true
        }));
      }

      setLastSyncedAt(new Date());
    } catch (err) {
      setBackend((prev) => ({
        ...prev,
        online: false,
        contractReady: false,
        startupError: getErrorMessage(err)
      }));
    } finally {
      if (showLoader) setRefreshing(false);
      setInitialLoadPending(false);
    }
  };

  const fetchSubscriptionStatus = async (selectedAccount = account, showLoader = false) => {
    if (!selectedAccount) return;

    try {
      if (showLoader) setStatusLoading(true);

      const response = await api.get(`/api/status/${selectedAccount}`);
      const details = response.data;

      setSubscriptionStatus({
        isActive: Boolean(details.isActive),
        expiry: details.expiry,
        tier: Number(details.tier),
        expiryDate: details.expiryDate ? formatPreciseDateTime(details.expiryDate) : 'No subscription'
      });

      if (details.tierPrices) {
        setTierPrices(details.tierPrices);
      }

      setLastSyncedAt(new Date());
    } catch (apiError) {
      if (contract) {
        try {
          const details = await contract.getSubscriptionDetails(selectedAccount);
          setSubscriptionStatus({
            isActive: details.isActive,
            expiry: details.expiry.toString(),
            tier: Number(details.tier),
            expiryDate: Number(details.expiry) > 0
              ? formatPreciseDateTime(Number(details.expiry) * 1000)
              : 'No subscription'
          });
          setLastSyncedAt(new Date());
          return;
        } catch (chainError) {
          setError(getErrorMessage(chainError));
        }
      } else {
        setError(getErrorMessage(apiError));
      }

      setSubscriptionStatus({
        isActive: false,
        expiry: '0',
        tier: 0,
        expiryDate: 'No subscription'
      });
    } finally {
      if (showLoader) setStatusLoading(false);
    }
  };

  const refreshAll = async () => {
    setError(null);
    await loadBackendInfo(true);
    if (account) {
      await fetchSubscriptionStatus(account, true);
      await syncTransactionsFromBackend(account, true);
    }
  };

  const syncTransactionsFromBackend = async (selectedAccount = account, showLoader = false) => {
    if (!selectedAccount) return;

    try {
      if (showLoader) setTxSyncing(true);

      const response = await api.get(`/api/transactions/${selectedAccount}?limit=20`);
      const backendTx = Array.isArray(response?.data?.transactions)
        ? response.data.transactions
        : [];

      const normalized = backendTx.map((tx) => ({
        id: tx.id || tx.clientId || tx.hash,
        clientId: tx.clientId || tx.id || tx.hash,
        hash: tx.hash || null,
        type: tx.type || 'Unknown',
        status: tx.status || 'pending',
        account: tx.address || selectedAccount,
        tier: tx.tier || null,
        amount: tx.amount || null,
        blockNumber: tx.blockNumber || null,
        error: tx.error || null,
        timestamp: tx.updatedAt || tx.timestamp || tx.createdAt || new Date().toISOString()
      }));

      setTransactions((prev) => mergeTxRecords(normalized, prev));
    } catch (err) {
      console.error('Failed to sync transactions from backend:', err);
    } finally {
      if (showLoader) setTxSyncing(false);
    }
  };

  const saveTxToBackend = async (payload) => {
    try {
      await api.post('/api/transactions', payload);
    } catch (err) {
      console.error('Failed to save transaction to backend:', err);
    }
  };

  const patchTxInBackend = async (idOrHash, payload) => {
    if (!idOrHash) return;

    try {
      await api.patch(`/api/transactions/${encodeURIComponent(idOrHash)}`, payload);
    } catch (err) {
      console.error('Failed to update transaction in backend:', err);
    }
  };

  const connectWallet = async () => {
    try {
      setLoading(true);
      setError(null);
      setNotice(null);

      if (!walletAvailable) {
        throw new Error('MetaMask is not installed in your browser');
      }

      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const nextProvider = new ethers.BrowserProvider(window.ethereum);
      const network = await nextProvider.getNetwork();
      const nextChainId = Number(network.chainId);

      setChainId(nextChainId);

      if (nextChainId !== EXPECTED_CHAIN_ID) {
        throw new Error(`Wrong network. Please switch MetaMask to chain ID ${EXPECTED_CHAIN_ID}`);
      }

      const nextContract = await buildSignerContract(nextProvider);
      setContract(nextContract);
      setAccount(accounts[0]);
      setNotice('Wallet connected successfully');

      const [basicPrice, premiumPrice] = await Promise.all([
        nextContract.tierPrices(0),
        nextContract.tierPrices(1)
      ]);

      setTierPrices({
        basic: ethers.formatEther(basicPrice),
        premium: ethers.formatEther(premiumPrice)
      });
    } catch (err) {
      setError(getErrorMessage(err));
      setContract(null);
      setAccount(null);
    } finally {
      setLoading(false);
    }
  };

  const switchToExpectedNetwork = async () => {
    if (!walletAvailable) return;

    try {
      setSwitchingNetwork(true);
      setError(null);

      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${EXPECTED_CHAIN_ID.toString(16)}` }]
      });

      setNotice(`Switched to chain ${EXPECTED_CHAIN_ID}`);
    } catch (err) {
      if (err.code === 4902) {
        setError('Target chain is not in MetaMask. Add local network (RPC 127.0.0.1:8545, chain 1337).');
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setSwitchingNetwork(false);
    }
  };

  const copyWalletAddress = async () => {
    if (!account) return;

    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Failed to copy address to clipboard');
    }
  };

  const runTransaction = async (transactionFn, label, metadata = {}) => {
    const txId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      setLoading(true);
      setError(null);
      setNotice(null);

      const tx = await transactionFn();
      const nowIso = new Date().toISOString();

      const pendingTx = {
        id: txId,
        clientId: txId,
        type: label,
        status: 'pending',
        hash: tx.hash,
        account,
        tier: metadata.tier || null,
        amount: metadata.amount || null,
        timestamp: nowIso
      };

      appendTx(pendingTx);
      await saveTxToBackend({
        clientId: txId,
        hash: tx.hash,
        address: account,
        type: label,
        tier: metadata.tier || null,
        amount: metadata.amount || null,
        status: 'pending',
        chainId,
        timestamp: nowIso
      });

      const receipt = await tx.wait();
      const confirmedAt = new Date().toISOString();

      updateTx(tx.hash || txId, {
        status: 'confirmed',
        blockNumber: receipt.blockNumber,
        timestamp: confirmedAt
      });
      await patchTxInBackend(tx.hash || txId, {
        status: 'confirmed',
        blockNumber: receipt.blockNumber,
        timestamp: confirmedAt
      });

      await fetchSubscriptionStatus();
      await loadBackendInfo();
      await syncTransactionsFromBackend(account);
      setNotice(`${label} completed successfully`);
    } catch (err) {
      const failedAt = new Date().toISOString();
      const errorText = getErrorMessage(err);

      updateTx(txId, {
        status: 'failed',
        error: errorText,
        timestamp: failedAt
      });
      await patchTxInBackend(txId, {
        status: 'failed',
        error: errorText,
        timestamp: failedAt
      });
      await saveTxToBackend({
        clientId: txId,
        address: account,
        type: label,
        tier: metadata.tier || null,
        amount: metadata.amount || null,
        status: 'failed',
        error: errorText,
        chainId,
        timestamp: failedAt
      });

      setError(errorText);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (tier) => {
    if (!contract) return;

    const price = tier === 0 ? tierPrices.basic : tierPrices.premium;

    await runTransaction(async () => {
      return contract.subscribe(tier, { value: ethers.parseEther(price) });
    }, 'Subscribe', { tier: getTierLabel(tier), amount: `${price} ETH` });
  };

  const handleRenew = async (tier) => {
    if (!contract) return;

    const price = tier === 0 ? tierPrices.basic : tierPrices.premium;

    await runTransaction(async () => {
      return contract.renew(tier, { value: ethers.parseEther(price) });
    }, 'Renew', { tier: getTierLabel(tier), amount: `${price} ETH` });
  };

  const handleUnsubscribe = async () => {
    if (!contract) return;

    await runTransaction(async () => {
      return contract.unsubscribe();
    }, 'Unsubscribe', { tier: null, amount: null });
  };

  const clearTxHistory = () => {
    setTransactions([]);
    setNotice('Transaction history cleared');
  };

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(TX_HISTORY_STORAGE_KEY, JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    loadBackendInfo();

    if (!walletAvailable) return undefined;

    const nextProvider = new ethers.BrowserProvider(window.ethereum);

    window.ethereum.request({ method: 'eth_accounts' }).then(async (accounts) => {
      const network = await nextProvider.getNetwork();
      setChainId(Number(network.chainId));

      if (accounts.length > 0) {
        try {
          const nextContract = await buildSignerContract(nextProvider);
          setContract(nextContract);
          setAccount(accounts[0]);
        } catch {
          setContract(null);
          setAccount(null);
        }
      }
    }).catch(() => {
      setAccount(null);
    });

    const onAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        setAccount(null);
        setContract(null);
        setSubscriptionStatus(null);
        setNotice('Wallet disconnected');
        return;
      }

      setAccount(accounts[0]);
      setNotice('Wallet account changed');
    };

    const onChainChanged = () => {
      window.location.reload();
    };

    window.ethereum.on('accountsChanged', onAccountsChanged);
    window.ethereum.on('chainChanged', onChainChanged);

    return () => {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener('accountsChanged', onAccountsChanged);
        window.ethereum.removeListener('chainChanged', onChainChanged);
      }
    };
  }, []);

  useEffect(() => {
    if (account) {
      fetchSubscriptionStatus(account, true);
      syncTransactionsFromBackend(account, true);
    }
  }, [account, contract]);

  useEffect(() => {
    if (!subscriptionStatus?.isActive) {
      setCountdown(null);
      return undefined;
    }

    setCountdown(formatCountdown(subscriptionStatus.expiry));

    const timer = setInterval(() => {
      setCountdown(formatCountdown(subscriptionStatus.expiry));
    }, 1000);

    return () => clearInterval(timer);
  }, [subscriptionStatus]);

  useEffect(() => {
    if (!account) return undefined;

    const interval = setInterval(async () => {
      await loadBackendInfo();
      await fetchSubscriptionStatus(account);
      await syncTransactionsFromBackend(account);
    }, 20000);

    return () => clearInterval(interval);
  }, [account, contract]);

  useEffect(() => {
    const clock = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(clock);
  }, []);

  return (
    <div className={`min-h-screen p-4 transition-colors duration-300 ${themeBackground}`}>
      <div className="max-w-6xl mx-auto">
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-cyan-500 rounded-full mix-blend-screen filter blur-xl opacity-20 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-orange-500 rounded-full mix-blend-screen filter blur-xl opacity-20 animate-pulse animation-delay-2000"></div>
          <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-blue-500 rounded-full mix-blend-screen filter blur-xl opacity-20 animate-pulse animation-delay-4000"></div>
        </div>

        <header className="text-center mb-10 relative z-10">
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              className="theme-toggle-btn"
            >
              {theme === 'dark' ? 'Light Theme' : 'Dark Theme'}
            </button>
          </div>

          <h1 className={`text-4xl sm:text-5xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 via-blue-300 to-orange-300 ${titleText}`}>
            Subscription DApp
          </h1>
          <p className={`text-base sm:text-lg ${subtitleText}`}>Secure on-chain membership with live backend sync</p>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 max-w-6xl mx-auto">
            <div className="status-tile cursor-pointer hover:bg-white/20 transition-all" onClick={() => setShowStatsPanel(!showStatsPanel)}>
              <p className="status-label">Backend</p>
              <p className={`status-value ${!backend.online ? 'text-red-300' : backend.contractReady ? 'text-emerald-300' : 'text-amber-300'}`}>{backendStatusText}</p>
              <p className="text-[10px] text-slate-400 mt-1">Click for stats</p>
            </div>
            <div className="status-tile">
              <p className="status-label">Contract</p>
              <p className={`status-value ${backend.contractReady ? 'text-emerald-300' : 'text-amber-300'}`}>
                {backend.contractReady ? 'Connected' : 'Not Ready'}
              </p>
            </div>
            <div className="status-tile">
              <p className="status-label">Wallet Network</p>
              <p className={`status-value ${networkMatches ? 'text-white' : 'text-amber-300'}`}>
                {chainId ?? '-'} / {EXPECTED_CHAIN_ID}
              </p>
            </div>
            <div className="status-tile">
              <p className="status-label">Last Sync</p>
              <p className="status-value text-white">{formatPreciseDateTime(lastSyncedAt)}</p>
            </div>
            <div className="status-tile">
              <p className="status-label">Current Time</p>
              <p className="status-value text-white">{formatPreciseTime(now)}</p>
              <p className="text-[11px] text-slate-300 mt-1">{timeZoneLabel}</p>
            </div>
          </div>

          {showStatsPanel && backend.contractReady && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-4xl mx-auto">
              <div className="stats-card">
                <div className="stats-icon bg-blue-500">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <div>
                  <p className="stats-label">Active Subscribers</p>
                  <p className="stats-value">{stats.activeSubscribers}</p>
                </div>
              </div>
              <div className="stats-card">
                <div className="stats-icon bg-emerald-500">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="stats-label">Total Revenue</p>
                  <p className="stats-value">{parseFloat(stats.revenue).toFixed(4)} ETH</p>
                </div>
              </div>
              <div className="stats-card">
                <div className="stats-icon bg-purple-500">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div>
                  <p className="stats-label">Total Subscribers</p>
                  <p className="stats-value">{stats.totalSubscribers}</p>
                </div>
              </div>
            </div>
          )}
        </header>

        {error && <div className="alert-box alert-error">{error}</div>}
        {notice && <div className="alert-box alert-success">{notice}</div>}

        {!networkMatches && (
          <div className="alert-box alert-warning">
            Wallet is on a different network. Switch to chain ID {EXPECTED_CHAIN_ID}.
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6 mb-8">
          <div className="card lg:col-span-1">
            <h2 className="text-2xl font-bold text-slate-800 mb-1">Wallet</h2>
            <p className="text-sm text-slate-500 mb-5">Connect and manage your session</p>

            {!account ? (
              <div className="space-y-3">
                <button
                  onClick={connectWallet}
                  disabled={loading || !walletAvailable}
                  className="wallet-connect-btn w-full"
                >
                  {loading ? 'Connecting...' : walletAvailable ? 'Connect MetaMask' : 'MetaMask Not Installed'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                  <p className="text-xs text-emerald-700 font-semibold mb-1">CONNECTED ACCOUNT</p>
                  <p className="font-mono text-xs sm:text-sm text-slate-700 break-all">{account}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button onClick={copyWalletAddress} className="secondary-action-btn">
                    {copied ? 'Copied' : `Copy ${shortenAddress(account)}`}
                  </button>
                  <button onClick={refreshAll} disabled={refreshing} className="secondary-action-btn">
                    {refreshing ? 'Refreshing...' : 'Refresh Data'}
                  </button>
                </div>

                {!networkMatches && (
                  <button
                    onClick={switchToExpectedNetwork}
                    disabled={switchingNetwork}
                    className="secondary-action-btn border-amber-400 text-amber-700 hover:bg-amber-50"
                  >
                    {switchingNetwork ? 'Switching...' : `Switch Network (${EXPECTED_CHAIN_ID})`}
                  </button>
                )}

                <div className="text-xs text-slate-500 bg-slate-100 p-3 rounded-lg">
                  Contract: <span className="font-mono">{effectiveContractAddress}</span>
                </div>
              </div>
            )}
          </div>

          <div className="card lg:col-span-2">
            <h2 className="text-2xl font-bold text-slate-800 mb-1">Subscription Status</h2>
            <p className="text-sm text-slate-500 mb-5">Live status from backend and blockchain</p>

            {statusLoading || initialLoadPending ? (
              <div className="space-y-3">
                <div className="skeleton h-6 w-48"></div>
                <div className="skeleton h-20 w-full"></div>
                <div className="skeleton h-20 w-full"></div>
              </div>
            ) : !account ? (
              <div className="empty-state">Connect wallet to load your subscription details.</div>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold ${subscriptionStatus?.isActive ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 pulse-glow' : 'bg-rose-100 text-rose-800 border border-rose-200'}`}>
                    <span className={`w-2 h-2 rounded-full mr-2 ${subscriptionStatus?.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
                    {subscriptionStatus?.isActive ? 'Active Subscription' : 'No Active Subscription'}
                  </div>

                  {subscriptionStatus?.isActive ? (
                    <>
                      <div className="info-panel bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200">
                        <p className="panel-label text-blue-700">Current Tier</p>
                        <div className="flex items-center justify-between">
                          <p className="panel-value text-blue-900">{subscriptionStatus.tier === 1 ? '⭐ Premium' : '📦 Basic'}</p>
                          {subscriptionStatus.tier === 1 && (
                            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full font-semibold">VIP</span>
                          )}
                        </div>
                      </div>
                      <div className="info-panel bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
                        <p className="panel-label text-purple-700">Expires On</p>
                        <p className="panel-value text-purple-900">{subscriptionStatus.expiryDate}</p>
                        {subscriptionStatus.expiry && Number(subscriptionStatus.expiry) > 0 && (
                          <p className="text-xs text-purple-600 mt-1">
                            {Math.ceil((Number(subscriptionStatus.expiry) - Math.floor(Date.now() / 1000)) / (24 * 60 * 60))} days remaining
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setShowUnsubscribeConfirm(true)}
                        disabled={loading}
                        className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white font-semibold py-3 px-4 rounded-lg transition duration-200 transform hover:scale-105"
                      >
                        Cancel Subscription
                      </button>
                    </>
                  ) : (
                    <div className="empty-state">
                      <svg className="w-16 h-16 mx-auto mb-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <p className="text-slate-600 font-semibold mb-1">No Active Subscription</p>
                      <p className="text-sm text-slate-500">Subscribe to activate your plan and start enjoying benefits</p>
                    </div>
                  )}
                </div>

                <div>
                  {subscriptionStatus?.isActive && countdown ? (
                    <div className="bg-gradient-to-br from-cyan-600 via-blue-700 to-purple-700 rounded-xl p-6 text-white shadow-xl relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
                      <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full -ml-12 -mb-12"></div>
                      <div className="relative z-10">
                        <p className="font-semibold mb-2 flex items-center">
                          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Time Remaining
                        </p>
                        <p className="text-4xl font-bold mb-1">{countdown}</p>
                        <p className="text-sm text-cyan-100">Auto-refresh every 20 seconds</p>
                        <div className="mt-4 pt-4 border-t border-white/20">
                          <p className="text-xs text-cyan-200 mb-1">Subscription Benefits</p>
                          <div className="flex items-center text-sm">
                            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            Full access to all features
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state h-full flex flex-col items-center justify-center">
                      <svg className="w-20 h-20 text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-slate-600 font-semibold">No Active Timer</p>
                      <p className="text-sm text-slate-500 mt-1">Countdown appears when subscription is active</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {account && (
          <div className="card mb-8">
            <h2 className="text-3xl font-bold text-slate-800 mb-2 text-center">Choose Your Plan</h2>
            <p className="text-slate-500 text-center mb-8">Pick a tier and confirm in MetaMask</p>

            {(initialLoadPending || statusLoading) ? (
              <div className="grid md:grid-cols-2 gap-8">
                <div className="skeleton h-64 w-full"></div>
                <div className="skeleton h-64 w-full"></div>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-8">
                <div className="plan-card border-cyan-200 hover:border-cyan-400 hover:shadow-xl transition-all">
                  <div className="plan-header">
                    <h3 className="text-2xl font-bold text-slate-800">Basic</h3>
                    <span className="plan-pill bg-cyan-100 text-cyan-700">Starter</span>
                  </div>
                  <p className="text-slate-500 mb-4">Great for first-time users</p>
                  <p className="text-4xl font-bold text-slate-900 mb-2">
                    {tierPrices.basic}<span className="text-lg text-slate-500 ml-2">ETH</span>
                  </p>
                  <p className="text-xs text-slate-400 mb-6">30 days access</p>
                  
                  <ul className="space-y-2 mb-6">
                    <li className="flex items-center text-sm text-slate-600">
                      <svg className="w-5 h-5 text-cyan-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Standard features
                    </li>
                    <li className="flex items-center text-sm text-slate-600">
                      <svg className="w-5 h-5 text-cyan-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Email support
                    </li>
                    <li className="flex items-center text-sm text-slate-600">
                      <svg className="w-5 h-5 text-cyan-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Basic analytics
                    </li>
                  </ul>

                  {!subscriptionStatus?.isActive ? (
                    <button
                      onClick={() => handleSubscribe(0)}
                      disabled={loading || !networkMatches || !backend.contractReady}
                      className="subscribe-btn w-full"
                    >
                      {loading ? 'Processing...' : 'Subscribe Basic'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRenew(0)}
                      disabled={loading || !networkMatches || !backend.contractReady}
                      className="renew-btn w-full"
                    >
                      {loading ? 'Processing...' : 'Renew Basic'}
                    </button>
                  )}
                </div>

                <div className="plan-card border-orange-200 hover:border-orange-400 hover:shadow-xl transition-all relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-gradient-to-br from-orange-500 to-rose-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
                    BEST VALUE
                  </div>
                  <div className="plan-header">
                    <h3 className="text-2xl font-bold text-slate-800">Premium</h3>
                    <span className="plan-pill bg-orange-100 text-orange-700">Popular</span>
                  </div>
                  <p className="text-slate-500 mb-4">Priority and full access tier</p>
                  <p className="text-4xl font-bold text-slate-900 mb-2">
                    {tierPrices.premium}<span className="text-lg text-slate-500 ml-2">ETH</span>
                  </p>
                  <p className="text-xs text-slate-400 mb-6">30 days access</p>
                  
                  <ul className="space-y-2 mb-6">
                    <li className="flex items-center text-sm text-slate-600">
                      <svg className="w-5 h-5 text-orange-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      All Basic features
                    </li>
                    <li className="flex items-center text-sm text-slate-600">
                      <svg className="w-5 h-5 text-orange-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Priority support 24/7
                    </li>
                    <li className="flex items-center text-sm text-slate-600">
                      <svg className="w-5 h-5 text-orange-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Advanced analytics
                    </li>
                    <li className="flex items-center text-sm text-slate-600">
                      <svg className="w-5 h-5 text-orange-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Exclusive features
                    </li>
                  </ul>

                  {!subscriptionStatus?.isActive ? (
                    <button
                      onClick={() => handleSubscribe(1)}
                      disabled={loading || !networkMatches || !backend.contractReady}
                      className="subscribe-btn w-full bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600"
                    >
                      {loading ? 'Processing...' : 'Subscribe Premium'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRenew(1)}
                      disabled={loading || !networkMatches || !backend.contractReady}
                      className="renew-btn w-full bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600"
                    >
                      {loading ? 'Processing...' : 'Renew Premium'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="card mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-800">Transaction History</h2>
              <p className="text-sm text-slate-500">Latest 20 local transactions • {filteredTransactions.length} shown</p>
            </div>
            <button onClick={clearTxHistory} className="secondary-action-btn w-auto px-4 py-2">
              Clear All
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by type, hash, tier, or amount..."
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setTxFilter('all')}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition ${txFilter === 'all' ? 'bg-cyan-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                All
              </button>
              <button
                onClick={() => setTxFilter('confirmed')}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition ${txFilter === 'confirmed' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                Confirmed
              </button>
              <button
                onClick={() => setTxFilter('pending')}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition ${txFilter === 'pending' ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                Pending
              </button>
              <button
                onClick={() => setTxFilter('failed')}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition ${txFilter === 'failed' ? 'bg-rose-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                Failed
              </button>
            </div>
          </div>

          {(txSyncing && transactions.length === 0) ? (
            <div className="space-y-3">
              <div className="skeleton h-16 w-full"></div>
              <div className="skeleton h-16 w-full"></div>
              <div className="skeleton h-16 w-full"></div>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="empty-state">
              {txSearch || txFilter !== 'all' ? (
                <>
                  <svg className="w-16 h-16 mx-auto mb-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p className="text-slate-600 font-semibold">No matching transactions</p>
                  <p className="text-sm text-slate-500 mt-1">Try adjusting your filters or search term</p>
                </>
              ) : (
                <>
                  <svg className="w-16 h-16 mx-auto mb-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-slate-600 font-semibold">No transactions yet</p>
                  <p className="text-sm text-slate-500 mt-1">Make a subscription action to see records here</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTransactions.map((tx) => (
                <div key={tx.id} className="tx-row hover:shadow-md transition-shadow">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="tx-title">{tx.type}</p>
                      {tx.tier && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                          {tx.tier}
                        </span>
                      )}
                    </div>
                    <p className="tx-meta">
                      {tx.amount && <span className="font-semibold text-slate-700">{tx.amount}</span>}
                      {tx.amount && ' • '}
                      {tx.timestamp ? formatPreciseDateTime(tx.timestamp) : 'Unknown time'}
                    </p>
                    <p className="tx-meta font-mono flex items-center gap-2">
                      {tx.hash ? (
                        <>
                          {shortenAddress(tx.hash)}
                          <button
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(tx.hash);
                                setNotice('Transaction hash copied!');
                                setTimeout(() => setNotice(null), 2000);
                              } catch {
                                setError('Failed to copy hash');
                              }
                            }}
                            className="text-cyan-600 hover:text-cyan-800 text-xs"
                          >
                            Copy
                          </button>
                        </>
                      ) : (
                        'No hash available'
                      )}
                    </p>
                    {tx.error && (
                      <div className="mt-2 bg-red-50 border border-red-200 rounded px-2 py-1">
                        <p className="text-xs text-red-700 font-semibold">Error:</p>
                        <p className="text-xs text-red-600">{tx.error}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`tx-status ${tx.status}`}>
                      {tx.status}
                    </span>
                    {tx.blockNumber && (
                      <span className="text-xs text-slate-500">
                        Block #{tx.blockNumber}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showUnsubscribeConfirm && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-8 max-w-md mx-4 shadow-2xl">
              <h3 className="text-2xl font-bold text-slate-900 mb-3">Unsubscribe Confirmation</h3>
              <p className="text-slate-600 mb-6">You will lose access immediately. Continue?</p>
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowUnsubscribeConfirm(false)}
                  className="flex-1 px-4 py-3 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setShowUnsubscribeConfirm(false);
                    await handleUnsubscribe();
                  }}
                  disabled={loading || !networkMatches}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg"
                >
                  {loading ? 'Unsubscribing...' : 'Yes, Unsubscribe'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
