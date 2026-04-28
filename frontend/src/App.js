import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';
import './App.css';

// ─── Constants ────────────────────────────────────────────────────────────────
const FALLBACK_LOCAL_CONTRACT = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const EXPECTED_CHAIN_ID = Number(process.env.REACT_APP_NETWORK_ID || 1337);
const TX_HISTORY_STORAGE_KEY = 'subscription_dapp_tx_history';
const THEME_STORAGE_KEY = 'subscription_dapp_theme';
const SUBSCRIPTION_DURATION_DAYS = 30;
const EXPECTED_CHAIN_HEX = `0x${EXPECTED_CHAIN_ID.toString(16)}`;

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
  },
  {
    inputs: [],
    name: 'getBalance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
];

// ─── Axios instance ────────────────────────────────────────────────────────────
const api = axios.create({ timeout: 8000 });

// ─── Formatters ───────────────────────────────────────────────────────────────
const preciseDateTimeFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
});
const preciseTimeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', second: '2-digit'
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
  const days    = Math.floor(timeLeft / 86400);
  const hours   = Math.floor((timeLeft % 86400) / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function getSubscriptionProgress(expiry) {
  if (!expiry || Number(expiry) === 0) return 0;
  const now        = Math.floor(Date.now() / 1000);
  const totalSecs  = SUBSCRIPTION_DURATION_DAYS * 86400;
  const startSecs  = Number(expiry) - totalSecs;
  const elapsed    = now - startSecs;
  const pct        = Math.min(100, Math.max(0, (elapsed / totalSecs) * 100));
  return Math.round(pct);
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

function detectEthereumProvider() {
  if (typeof window === 'undefined') return null;
  const { ethereum } = window;
  if (!ethereum) return null;

  if (Array.isArray(ethereum.providers) && ethereum.providers.length > 0) {
    return ethereum.providers.find((provider) => provider?.isMetaMask) || ethereum.providers[0];
  }

  return ethereum;
}

// ─── Toast system ─────────────────────────────────────────────────────────────
let toastIdCounter = 0;

function useToasts() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const CheckIcon = () => (
  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const WalletIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
  </svg>
);

const RefreshIcon = ({ spinning }) => (
  <svg className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const CopyIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg className="w-3 h-3 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

const ShieldIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const StarIcon = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type} animate-slide-in-right`}>
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onRemove(t.id)} className="opacity-60 hover:opacity-100 transition-opacity">
            <XIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ isActive }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide
      ${isActive
        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 pulse-glow'
        : 'bg-rose-100 text-rose-800 border border-rose-200'}`}>
      <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-rose-400'}`} />
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

function ProgressBar({ percent, colorClass = 'bg-gradient-to-r from-cyan-500 to-blue-600' }) {
  return (
    <div className="progress-bar-track">
      <div
        className={`progress-bar-fill ${colorClass}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function StatCard({ icon, label, value, sub, iconBg = 'bg-cyan-600' }) {
  return (
    <div className="stats-card">
      <div className={`stats-icon ${iconBg}`}>{icon}</div>
      <div>
        <p className="stats-label">{label}</p>
        <p className="stats-value">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function FeatureItem({ text }) {
  return (
    <li className="flex items-center gap-2 text-sm text-slate-600">
      <span className="text-cyan-500"><CheckIcon /></span>
      {text}
    </li>
  );
}

function PremiumFeatureItem({ text }) {
  return (
    <li className="flex items-center gap-2 text-sm text-slate-600">
      <span className="text-orange-500"><CheckIcon /></span>
      {text}
    </li>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
  // Wallet / chain state
  const [contract, setContract]   = useState(null);
  const [account, setAccount]     = useState(null);
  const [chainId, setChainId]     = useState(null);
  const [walletBalance, setWalletBalance] = useState(null);
  const [walletProvider, setWalletProvider] = useState(detectEthereumProvider);

  // Loading flags
  const [loading, setLoading]               = useState(false);
  const [refreshing, setRefreshing]         = useState(false);
  const [statusLoading, setStatusLoading]   = useState(false);
  const [initialLoadPending, setInitialLoadPending] = useState(true);
  const [txSyncing, setTxSyncing]           = useState(false);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);

  // UI state
  const [theme, setTheme]   = useState(getInitialTheme);
  const [copied, setCopied] = useState(false);
  const [showUnsubscribeConfirm, setShowUnsubscribeConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'history'

  // Data
  const [transactions, setTransactions]         = useState(getInitialTxHistory);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [countdown, setCountdown]               = useState(null);
  const [tierPrices, setTierPrices]             = useState({ basic: null, premium: null });
  const [lastSyncedAt, setLastSyncedAt]         = useState(null);
  const [now, setNow]                           = useState(() => new Date());
  const [contractBalance, setContractBalance]   = useState(null);

  const [backend, setBackend] = useState({
    online: false,
    contractReady: false,
    chainId: null,
    contractAddress: process.env.REACT_APP_CONTRACT_ADDRESS || FALLBACK_LOCAL_CONTRACT,
    startupError: null
  });

  // Toasts
  const { toasts, addToast, removeToast } = useToasts();

  // Refs to avoid stale closures in intervals
  const accountRef  = useRef(account);
  const contractRef = useRef(contract);
  useEffect(() => { accountRef.current  = account;  }, [account]);
  useEffect(() => { contractRef.current = contract; }, [contract]);

  // ─── Derived values ──────────────────────────────────────────────────────────
  const walletAvailable  = Boolean(walletProvider);
  const networkMatches   = chainId === null ? true : Number(chainId) === EXPECTED_CHAIN_ID;
  const subscriptionProgress = subscriptionStatus?.isActive
    ? getSubscriptionProgress(subscriptionStatus.expiry)
    : 0;

  const effectiveContractAddress = useMemo(() => (
    backend.contractAddress || process.env.REACT_APP_CONTRACT_ADDRESS || FALLBACK_LOCAL_CONTRACT
  ), [backend.contractAddress]);
  const pricesReady = Boolean(tierPrices.basic && tierPrices.premium);

  const backendStatusText = useMemo(() => {
    if (!backend.online) return 'Offline';
    if (!backend.contractReady) return 'Initializing…';
    return 'Ready';
  }, [backend.online, backend.contractReady]);

  const themeBackground = theme === 'dark'
    ? 'bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950'
    : 'bg-gradient-to-br from-amber-50 via-sky-100 to-orange-100';

  const totalEthSpent = useMemo(() => {
    const confirmed = transactions.filter((t) => t.status === 'confirmed' && t.amount);
    const total = confirmed.reduce((sum, t) => {
      const val = parseFloat(t.amount?.replace(' ETH', '') || '0');
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
    return total.toFixed(4);
  }, [transactions]);

  const confirmedCount = useMemo(
    () => transactions.filter((t) => t.status === 'confirmed').length,
    [transactions]
  );

  // ─── Tx helpers ──────────────────────────────────────────────────────────────
  const appendTx = (item) => setTransactions((prev) => mergeTxRecords([item], prev));

  const updateTx = (idOrHash, patch) => {
    setTransactions((prev) =>
      prev.map((tx) => {
        const matched = tx.id === idOrHash || tx.hash === idOrHash || tx.clientId === idOrHash;
        return matched ? { ...tx, ...patch } : tx;
      })
    );
  };

  // ─── Contract builder ────────────────────────────────────────────────────────
  const buildSignerContract = async (nextProvider) => {
    if (!effectiveContractAddress) {
      throw new Error('Contract address is unavailable');
    }
    const signer = await nextProvider.getSigner();
    return new ethers.Contract(effectiveContractAddress, contractABI, signer);
  };

  // ─── Wallet balance ──────────────────────────────────────────────────────────
  const fetchWalletBalance = async (addr) => {
    if (!addr || !walletProvider) return;
    try {
      const provider = new ethers.BrowserProvider(walletProvider);
      const bal = await provider.getBalance(addr);
      setWalletBalance(parseFloat(ethers.formatEther(bal)).toFixed(4));
    } catch {
      setWalletBalance(null);
    }
  };

  // ─── Backend info ─────────────────────────────────────────────────────────────
  const loadBackendInfo = async (showLoader = false) => {
    try {
      if (showLoader) setRefreshing(true);

      const [healthRes, statsRes] = await Promise.allSettled([
        api.get('/api/health'),
        api.get('/api/stats')
      ]);

      if (healthRes.status === 'fulfilled') {
        const p = healthRes.value.data;
        setBackend((prev) => ({
          ...prev,
          online: true,
          contractReady: Boolean(p.contractReady),
          chainId: p.chainId,
          startupError: p.startupError || null,
          contractAddress: p.contractAddress || prev.contractAddress
        }));
      } else {
        setBackend((prev) => ({
          ...prev,
          online: false,
          contractReady: false,
          startupError: getErrorMessage(healthRes.reason)
        }));
      }

      if (statsRes.status === 'fulfilled') {
        const p = statsRes.value.data;
        if (p.tierPrices) setTierPrices(p.tierPrices);
        if (p.contractBalance !== undefined) setContractBalance(p.contractBalance);
        setBackend((prev) => ({
          ...prev,
          contractAddress: p.contractAddress || prev.contractAddress,
          chainId: p.chainId ?? prev.chainId,
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

  // ─── Subscription status ──────────────────────────────────────────────────────
  const fetchSubscriptionStatus = async (selectedAccount = accountRef.current, showLoader = false) => {
    if (!selectedAccount) return;
    try {
      if (showLoader) setStatusLoading(true);
      const response = await api.get(`/api/status/${selectedAccount}`);
      const details  = response.data;
      setSubscriptionStatus({
        isActive:   Boolean(details.isActive),
        expiry:     details.expiry,
        tier:       Number(details.tier),
        expiryDate: details.expiryDate ? formatPreciseDateTime(details.expiryDate) : 'No subscription'
      });
      if (details.tierPrices) setTierPrices(details.tierPrices);
      setLastSyncedAt(new Date());
    } catch {
      const c = contractRef.current;
      if (c) {
        try {
          const details = await c.getSubscriptionDetails(selectedAccount);
          setSubscriptionStatus({
            isActive:   details.isActive,
            expiry:     details.expiry.toString(),
            tier:       Number(details.tier),
            expiryDate: Number(details.expiry) > 0
              ? formatPreciseDateTime(Number(details.expiry) * 1000)
              : 'No subscription'
          });
          setLastSyncedAt(new Date());
        } catch (chainErr) {
          addToast(getErrorMessage(chainErr), 'error');
          setSubscriptionStatus({ isActive: false, expiry: '0', tier: 0, expiryDate: 'No subscription' });
        }
      } else {
        setSubscriptionStatus({ isActive: false, expiry: '0', tier: 0, expiryDate: 'No subscription' });
      }
    } finally {
      if (showLoader) setStatusLoading(false);
    }
  };

  // ─── Refresh all ─────────────────────────────────────────────────────────────
  const refreshAll = async () => {
    await loadBackendInfo(true);
    if (accountRef.current) {
      await Promise.all([
        fetchSubscriptionStatus(accountRef.current, true),
        syncTransactionsFromBackend(accountRef.current, true),
        fetchWalletBalance(accountRef.current)
      ]);
    }
    addToast('Data refreshed', 'success', 2000);
  };

  // ─── Tx sync ──────────────────────────────────────────────────────────────────
  const syncTransactionsFromBackend = async (selectedAccount = accountRef.current, showLoader = false) => {
    if (!selectedAccount) return;
    try {
      if (showLoader) setTxSyncing(true);
      const response = await api.get(`/api/transactions/${selectedAccount}?limit=20`);
      const backendTx = Array.isArray(response?.data?.transactions) ? response.data.transactions : [];
      const normalized = backendTx.map((tx) => ({
        id:          tx.id || tx.clientId || tx.hash,
        clientId:    tx.clientId || tx.id || tx.hash,
        hash:        tx.hash || null,
        type:        tx.type || 'Unknown',
        status:      tx.status || 'pending',
        account:     tx.address || selectedAccount,
        tier:        tx.tier || null,
        amount:      tx.amount || null,
        blockNumber: tx.blockNumber || null,
        error:       tx.error || null,
        timestamp:   tx.updatedAt || tx.timestamp || tx.createdAt || new Date().toISOString()
      }));
      setTransactions((prev) => mergeTxRecords(normalized, prev));
    } catch (err) {
      console.error('Failed to sync transactions:', err);
    } finally {
      if (showLoader) setTxSyncing(false);
    }
  };

  const saveTxToBackend = async (payload) => {
    try { await api.post('/api/transactions', payload); } catch {}
  };

  const patchTxInBackend = async (idOrHash, payload) => {
    if (!idOrHash) return;
    try { await api.patch(`/api/transactions/${encodeURIComponent(idOrHash)}`, payload); } catch {}
  };

  // ─── Connect wallet ───────────────────────────────────────────────────────────
  const connectWallet = async () => {
    try {
      setLoading(true);
      if (!walletProvider) throw new Error('MetaMask is not installed');

      const accounts      = await walletProvider.request({ method: 'eth_requestAccounts' });
      let activeProvider  = new ethers.BrowserProvider(walletProvider);
      const network       = await activeProvider.getNetwork();
      let activeChainId   = Number(network.chainId);
      setChainId(activeChainId);

      if (activeChainId !== EXPECTED_CHAIN_ID) {
        const switched = await switchToExpectedNetwork(true);
        if (!switched) {
          throw new Error(`Wrong network. Please switch MetaMask to chain ID ${EXPECTED_CHAIN_ID}.`);
        }

        activeProvider = new ethers.BrowserProvider(walletProvider);
        const refreshedNetwork = await activeProvider.getNetwork();
        activeChainId = Number(refreshedNetwork.chainId);
        setChainId(activeChainId);

        if (activeChainId !== EXPECTED_CHAIN_ID) {
          throw new Error(`Network is still ${activeChainId}. Please switch to chain ID ${EXPECTED_CHAIN_ID}.`);
        }
      }

      const nextContract = await buildSignerContract(activeProvider);
      setContract(nextContract);
      setAccount(accounts[0]);

      const [basicPrice, premiumPrice] = await Promise.all([
        nextContract.tierPrices(0),
        nextContract.tierPrices(1)
      ]);
      setTierPrices({
        basic:   ethers.formatEther(basicPrice),
        premium: ethers.formatEther(premiumPrice)
      });

      await fetchWalletBalance(accounts[0]);
      addToast('Wallet connected successfully', 'success');
    } catch (err) {
      addToast(getErrorMessage(err), 'error');
      setContract(null);
      setAccount(null);
    } finally {
      setLoading(false);
    }
  };

  // ─── Switch network ───────────────────────────────────────────────────────────
  const switchToExpectedNetwork = async (silent = false) => {
    if (!walletProvider) return false;
    try {
      setSwitchingNetwork(true);
      await walletProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: EXPECTED_CHAIN_HEX }]
      });
      setChainId(EXPECTED_CHAIN_ID);
      if (!silent) addToast(`Switched to chain ${EXPECTED_CHAIN_ID}`, 'success');
      return true;
    } catch (err) {
      if (err.code === 4902) {
        try {
          await walletProvider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: EXPECTED_CHAIN_HEX,
              chainName: 'Hardhat Localhost',
              nativeCurrency: {
                name: 'Ether',
                symbol: 'ETH',
                decimals: 18
              },
              rpcUrls: ['http://127.0.0.1:8545']
            }]
          });

          await walletProvider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: EXPECTED_CHAIN_HEX }]
          });

          setChainId(EXPECTED_CHAIN_ID);
          if (!silent) addToast('Local network added and selected', 'success');
          return true;
        } catch (addError) {
          if (!silent) addToast(getErrorMessage(addError), 'error');
          return false;
        }
      } else {
        if (!silent) addToast(getErrorMessage(err), 'error');
        return false;
      }
    } finally {
      setSwitchingNetwork(false);
    }
  };

  // ─── Copy address ─────────────────────────────────────────────────────────────
  const copyWalletAddress = async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      addToast('Address copied to clipboard', 'info', 2000);
    } catch {
      addToast('Failed to copy address', 'error');
    }
  };

  // ─── Run transaction ──────────────────────────────────────────────────────────
  const runTransaction = async (transactionFn, label, metadata = {}) => {
    const txId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      setLoading(true);
      const tx      = await transactionFn();
      const nowIso  = new Date().toISOString();

      const pendingTx = {
        id: txId, clientId: txId, type: label, status: 'pending',
        hash: tx.hash, account, tier: metadata.tier || null,
        amount: metadata.amount || null, timestamp: nowIso
      };
      appendTx(pendingTx);
      addToast(`${label} submitted — waiting for confirmation…`, 'info', 6000);

      await saveTxToBackend({
        clientId: txId, hash: tx.hash, address: account, type: label,
        tier: metadata.tier || null, amount: metadata.amount || null,
        status: 'pending', chainId, timestamp: nowIso
      });

      const receipt     = await tx.wait();
      const confirmedAt = new Date().toISOString();

      updateTx(tx.hash || txId, { status: 'confirmed', blockNumber: receipt.blockNumber, timestamp: confirmedAt });
      await patchTxInBackend(tx.hash || txId, { status: 'confirmed', blockNumber: receipt.blockNumber, timestamp: confirmedAt });

      await Promise.all([
        fetchSubscriptionStatus(),
        loadBackendInfo(),
        syncTransactionsFromBackend(account),
        fetchWalletBalance(account)
      ]);

      addToast(`${label} confirmed on block #${receipt.blockNumber}`, 'success');
    } catch (err) {
      const failedAt  = new Date().toISOString();
      const errorText = getErrorMessage(err);
      updateTx(txId, { status: 'failed', error: errorText, timestamp: failedAt });
      await patchTxInBackend(txId, { status: 'failed', error: errorText, timestamp: failedAt });
      addToast(errorText, 'error', 6000);
    } finally {
      setLoading(false);
    }
  };

  // ─── Action handlers ──────────────────────────────────────────────────────────
  const handleSubscribe = async (tier) => {
    if (!contract) return;
    const price = tier === 0 ? tierPrices.basic : tierPrices.premium;
    if (!price) {
      addToast('Live plan price is not available yet. Please refresh.', 'warning');
      return;
    }
    await runTransaction(
      () => contract.subscribe(tier, { value: ethers.parseEther(price) }),
      'Subscribe',
      { tier: getTierLabel(tier), amount: `${price} ETH` }
    );
  };

  const handleRenew = async (tier) => {
    if (!contract) return;
    const price = tier === 0 ? tierPrices.basic : tierPrices.premium;
    if (!price) {
      addToast('Live plan price is not available yet. Please refresh.', 'warning');
      return;
    }
    await runTransaction(
      () => contract.renew(tier, { value: ethers.parseEther(price) }),
      'Renew',
      { tier: getTierLabel(tier), amount: `${price} ETH` }
    );
  };

  const handleUnsubscribe = async () => {
    if (!contract) return;
    await runTransaction(() => contract.unsubscribe(), 'Unsubscribe', {});
  };

  const clearTxHistory = () => {
    setTransactions([]);
    addToast('Transaction history cleared', 'info', 2000);
  };

  const syncWalletProvider = useCallback((notify = false) => {
    const detected = detectEthereumProvider();
    if (!detected) {
      if (notify) {
        addToast('MetaMask not detected yet. Make sure the extension is installed and unlocked, then refresh.', 'warning');
      }
      return false;
    }
    setWalletProvider((prev) => (prev === detected ? prev : detected));
    if (notify) addToast('Wallet detected. You can connect now.', 'success');
    return true;
  }, [addToast]);

  // ─── Effects ──────────────────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem(THEME_STORAGE_KEY, theme); }, [theme]);
  useEffect(() => { localStorage.setItem(TX_HISTORY_STORAGE_KEY, JSON.stringify(transactions)); }, [transactions]);

  // Detect wallet providers (supports async injection on some browsers/mobile)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let intervalId = null;
    let timeoutId = null;
    const onEthereumInitialized = () => { syncWalletProvider(); };

    window.addEventListener('ethereum#initialized', onEthereumInitialized, { once: true });

    if (!syncWalletProvider()) {
      intervalId = window.setInterval(() => {
        if (syncWalletProvider() && intervalId) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }, 300);
      timeoutId = window.setTimeout(() => {
        if (intervalId) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }, 5000);
    }

    return () => {
      window.removeEventListener('ethereum#initialized', onEthereumInitialized);
      if (intervalId) window.clearInterval(intervalId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [syncWalletProvider]);

  // Initial load + wallet listeners
  useEffect(() => {
    loadBackendInfo();
    if (!walletProvider) return undefined;

    const nextProvider = new ethers.BrowserProvider(walletProvider);

    walletProvider.request({ method: 'eth_accounts' }).then(async (accounts) => {
      const network = await nextProvider.getNetwork();
      setChainId(Number(network.chainId));
      if (accounts.length > 0) {
        try {
          const nextContract = await buildSignerContract(nextProvider);
          setContract(nextContract);
          setAccount(accounts[0]);
          fetchWalletBalance(accounts[0]);
        } catch {
          setContract(null);
          setAccount(null);
        }
      }
    }).catch(() => setAccount(null));

    const onAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        setAccount(null); setContract(null);
        setSubscriptionStatus(null); setWalletBalance(null);
        addToast('Wallet disconnected', 'warning');
        return;
      }
      setAccount(accounts[0]);
      addToast('Account changed', 'info');
    };

    const onChainChanged = () => window.location.reload();

    walletProvider.on('accountsChanged', onAccountsChanged);
    walletProvider.on('chainChanged', onChainChanged);
    return () => {
      if (walletProvider.removeListener) {
        walletProvider.removeListener('accountsChanged', onAccountsChanged);
        walletProvider.removeListener('chainChanged', onChainChanged);
      }
    };
  }, [walletProvider]);

  // Load data when account/contract changes
  useEffect(() => {
    if (account) {
      fetchSubscriptionStatus(account, true);
      syncTransactionsFromBackend(account, true);
    }
  }, [account, contract]);

  // Countdown timer
  useEffect(() => {
    if (!subscriptionStatus?.isActive) { setCountdown(null); return; }
    setCountdown(formatCountdown(subscriptionStatus.expiry));
    const timer = setInterval(() => setCountdown(formatCountdown(subscriptionStatus.expiry)), 1000);
    return () => clearInterval(timer);
  }, [subscriptionStatus]);

  // Auto-refresh every 20 s
  useEffect(() => {
    if (!account) return;
    const interval = setInterval(async () => {
      await loadBackendInfo();
      await fetchSubscriptionStatus(accountRef.current);
      await syncTransactionsFromBackend(accountRef.current);
    }, 20000);
    return () => clearInterval(interval);
  }, [account]);

  // Clock
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen p-4 transition-colors duration-300 ${themeBackground}`}>
      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Background blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-cyan-500 rounded-full mix-blend-screen filter blur-3xl opacity-20 animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-orange-500 rounded-full mix-blend-screen filter blur-3xl opacity-20 animate-pulse animation-delay-2000" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-blue-500 rounded-full mix-blend-screen filter blur-3xl opacity-15 animate-pulse animation-delay-4000" />
      </div>

      <div className="max-w-6xl mx-auto relative z-10">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <header className="text-center mb-10">
          <div className="flex items-center justify-between mb-6">
            {/* Network badge */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border
              ${networkMatches
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-amber-500/20 border-amber-500/40 text-amber-300'}`}>
              <span className={`w-2 h-2 rounded-full ${networkMatches ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              Chain {chainId ?? '—'}
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 via-blue-300 to-orange-300">
              SubChain
            </h1>

            <button
              onClick={() => setTheme((p) => (p === 'dark' ? 'light' : 'dark'))}
              className="theme-toggle-btn"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
            </button>
          </div>

          <p className={`text-base sm:text-lg mb-8 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
            Decentralised subscription management — powered by Ethereum
          </p>

          {/* Status tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="status-tile">
              <p className="status-label">Backend</p>
              <p className={`status-value ${!backend.online ? 'text-red-300' : backend.contractReady ? 'text-emerald-300' : 'text-amber-300'}`}>
                {backendStatusText}
              </p>
            </div>
            <div className="status-tile">
              <p className="status-label">Contract</p>
              <p className={`status-value ${backend.contractReady ? 'text-emerald-300' : 'text-amber-300'}`}>
                {backend.contractReady ? 'Connected' : 'Not Ready'}
              </p>
            </div>
            <div className="status-tile">
              <p className="status-label">Network</p>
              <p className={`status-value ${networkMatches ? 'text-white' : 'text-amber-300'}`}>
                {chainId ?? '—'} / {EXPECTED_CHAIN_ID}
              </p>
            </div>
            <div className="status-tile">
              <p className="status-label">Last Sync</p>
              <p className="status-value text-white text-xs">{formatPreciseDateTime(lastSyncedAt)}</p>
            </div>
            <div className="status-tile">
              <p className="status-label">Local Time</p>
              <p className="status-value text-white">{formatPreciseTime(now)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{timeZoneLabel}</p>
            </div>
          </div>
        </header>

        {/* ── Network warning ─────────────────────────────────────────────────── */}
        {!networkMatches && (
          <div className="alert-box alert-warning flex items-center justify-between">
            <span>⚠ Wallet is on a different network. Switch to chain ID {EXPECTED_CHAIN_ID}.</span>
            <button
              onClick={switchToExpectedNetwork}
              disabled={switchingNetwork}
              className="ml-4 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition"
            >
              {switchingNetwork ? 'Switching…' : 'Switch Now'}
            </button>
          </div>
        )}

        {/* ── Stats row (only when wallet connected) ──────────────────────────── */}
        {account && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <StatCard
              icon={<StatusBadge isActive={subscriptionStatus?.isActive} />}
              label="Subscription"
              value={subscriptionStatus?.isActive ? getTierLabel(subscriptionStatus.tier) : 'None'}
              iconBg="bg-transparent"
            />
            <StatCard
              icon={<span className="text-2xl">⏱</span>}
              label="Time Left"
              value={countdown || '—'}
              iconBg="bg-blue-600"
            />
            <StatCard
              icon={<span className="text-2xl">💎</span>}
              label="ETH Spent"
              value={`${totalEthSpent} ETH`}
              sub={`${confirmedCount} confirmed tx`}
              iconBg="bg-purple-600"
            />
            <StatCard
              icon={<span className="text-2xl">👛</span>}
              label="Wallet Balance"
              value={walletBalance !== null ? `${walletBalance} ETH` : '—'}
              iconBg="bg-cyan-700"
            />
          </div>
        )}

        {/* ── Tab navigation ───────────────────────────────────────────────────── */}
        <div className="flex gap-2 mb-6">
          {['dashboard', 'history'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-200
                ${activeTab === tab
                  ? 'bg-white text-slate-900 shadow-md'
                  : 'bg-white/10 text-white hover:bg-white/20'}`}
            >
              {tab === 'dashboard' ? '📊 Dashboard' : '📋 History'}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* DASHBOARD TAB                                                         */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'dashboard' && (
          <>
            {/* ── Wallet + Status row ─────────────────────────────────────────── */}
            <div className="grid lg:grid-cols-3 gap-6 mb-8">

              {/* Wallet card */}
              <div className="card lg:col-span-1">
                <div className="flex items-center gap-2 mb-1">
                  <WalletIcon />
                  <h2 className="text-xl font-bold text-slate-800">Wallet</h2>
                </div>
                <p className="text-sm text-slate-500 mb-5">Connect and manage your session</p>

                {!account ? (
                  <div className="space-y-2">
                    <button
                      onClick={connectWallet}
                      disabled={loading || !walletAvailable}
                      className="wallet-connect-btn w-full"
                    >
                      <WalletIcon />
                      {loading ? 'Connecting…' : walletAvailable ? 'Connect MetaMask' : 'MetaMask Not Found'}
                    </button>
                    {!walletAvailable && (
                      <button
                        onClick={() => syncWalletProvider(true)}
                        className="secondary-action-btn w-full"
                      >
                        Retry Wallet Detection
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                      <p className="text-xs text-emerald-700 font-bold mb-1 uppercase tracking-wide">Connected</p>
                      <p className="font-mono text-xs text-slate-700 break-all">{account}</p>
                      {walletBalance !== null && (
                        <p className="text-xs text-slate-500 mt-1">Balance: <span className="font-semibold text-slate-700">{walletBalance} ETH</span></p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={copyWalletAddress} className="secondary-action-btn flex items-center justify-center gap-1.5">
                        <CopyIcon />
                        {copied ? 'Copied!' : shortenAddress(account)}
                      </button>
                      <button onClick={refreshAll} disabled={refreshing} className="secondary-action-btn flex items-center justify-center gap-1.5">
                        <RefreshIcon spinning={refreshing} />
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                      </button>
                    </div>

                    <div className="text-xs text-slate-500 bg-slate-100 p-3 rounded-lg break-all">
                      <span className="font-semibold">Contract:</span>{' '}
                      <span className="font-mono">{effectiveContractAddress ? shortenAddress(effectiveContractAddress) : 'Unavailable'}</span>
                    </div>

                    {contractBalance !== null && (
                      <div className="text-xs text-slate-500 bg-slate-100 p-3 rounded-lg">
                        <span className="font-semibold">Contract Balance:</span>{' '}
                        <span className="font-mono text-slate-700">{contractBalance} ETH</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Subscription status card */}
              <div className="card lg:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <ShieldIcon />
                    <h2 className="text-xl font-bold text-slate-800">Subscription Status</h2>
                  </div>
                  {subscriptionStatus && <StatusBadge isActive={subscriptionStatus.isActive} />}
                </div>
                <p className="text-sm text-slate-500 mb-5">Live status from backend and blockchain</p>

                {statusLoading || initialLoadPending ? (
                  <div className="space-y-3">
                    <div className="skeleton h-6 w-48" />
                    <div className="skeleton h-20 w-full" />
                    <div className="skeleton h-20 w-full" />
                  </div>
                ) : !account ? (
                  <div className="empty-state">Connect your wallet to view subscription details.</div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      {subscriptionStatus?.isActive ? (
                        <>
                          <div className="info-panel">
                            <p className="panel-label">Current Tier</p>
                            <p className="panel-value flex items-center gap-2">
                              {subscriptionStatus.tier === 1
                                ? <><StarIcon /><span className="text-orange-600">Premium</span></>
                                : <><ShieldIcon /><span className="text-cyan-700">Basic</span></>}
                            </p>
                          </div>
                          <div className="info-panel">
                            <p className="panel-label">Expires On</p>
                            <p className="panel-value">{subscriptionStatus.expiryDate}</p>
                          </div>
                          <div className="info-panel">
                            <p className="panel-label">Subscription Progress</p>
                            <div className="mt-2">
                              <ProgressBar
                                percent={subscriptionProgress}
                                colorClass={subscriptionProgress > 80
                                  ? 'bg-gradient-to-r from-rose-500 to-red-600'
                                  : 'bg-gradient-to-r from-cyan-500 to-blue-600'}
                              />
                              <p className="text-xs text-slate-500 mt-1">{subscriptionProgress}% elapsed</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setShowUnsubscribeConfirm(true)}
                            disabled={loading}
                            className="danger-btn"
                          >
                            Cancel Subscription
                          </button>
                        </>
                      ) : (
                        <div className="empty-state">No active subscription. Choose a plan below.</div>
                      )}
                    </div>

                    <div>
                      {subscriptionStatus?.isActive && countdown ? (
                        <div className="bg-gradient-to-br from-cyan-600 to-blue-700 rounded-2xl p-6 text-white h-full flex flex-col justify-center">
                          <p className="text-sm font-semibold text-cyan-200 mb-1 uppercase tracking-wide">Time Remaining</p>
                          <p className="text-3xl font-extrabold mb-3 font-mono">{countdown}</p>
                          <ProgressBar
                            percent={100 - subscriptionProgress}
                            colorClass="bg-white/40"
                          />
                          <p className="text-xs text-cyan-200 mt-3">Auto-refreshes every 20 seconds</p>
                        </div>
                      ) : (
                        <div className="empty-state h-full flex items-center justify-center">
                          Countdown appears once your subscription is active.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Plans ───────────────────────────────────────────────────────── */}
            {account && (
              <div className="card mb-8">
                <h2 className="text-2xl font-bold text-slate-800 mb-1 text-center">Choose Your Plan</h2>
                <p className="text-slate-500 text-center mb-8">30-day access — confirm in MetaMask</p>

                {initialLoadPending || statusLoading ? (
                  <div className="grid md:grid-cols-2 gap-8">
                    <div className="skeleton h-72 w-full" />
                    <div className="skeleton h-72 w-full" />
                  </div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-8">

                    {/* Basic plan */}
                    <div className="plan-card border-cyan-200 hover:border-cyan-400">
                      <div className="plan-header">
                        <h3 className="text-2xl font-bold text-slate-800">Basic</h3>
                        <span className="plan-pill bg-cyan-100 text-cyan-700">Starter</span>
                      </div>
                      <p className="text-slate-500 mb-4 text-sm">Perfect for getting started on-chain</p>
                      <div className="mb-2">
                        <span className="text-4xl font-extrabold text-slate-900">{tierPrices.basic ?? '—'}</span>
                        {tierPrices.basic && <span className="text-lg text-slate-500 ml-2">ETH</span>}
                      </div>
                      <p className="text-xs text-slate-400 mb-6">30 days · renew anytime</p>
                      <ul className="space-y-2 mb-8">
                        <FeatureItem text="On-chain subscription proof" />
                        <FeatureItem text="Standard feature access" />
                        <FeatureItem text="Email support" />
                        <FeatureItem text="Basic analytics dashboard" />
                        <FeatureItem text="Renewal at any time" />
                      </ul>
                      {!subscriptionStatus?.isActive ? (
                        <button
                          onClick={() => handleSubscribe(0)}
                          disabled={loading || !networkMatches || !backend.contractReady || !tierPrices.basic || !pricesReady}
                          className="subscribe-btn w-full"
                        >
                          {loading ? 'Processing…' : 'Subscribe — Basic'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRenew(0)}
                          disabled={loading || !networkMatches || !backend.contractReady || !tierPrices.basic || !pricesReady}
                          className="renew-btn w-full"
                        >
                          {loading ? 'Processing…' : 'Renew — Basic'}
                        </button>
                      )}
                    </div>

                    {/* Premium plan */}
                    <div className="plan-card plan-card-featured border-orange-300 hover:border-orange-400">
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className="bg-gradient-to-r from-orange-500 to-rose-500 text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg">
                          ⭐ Most Popular
                        </span>
                      </div>
                      <div className="plan-header mt-3">
                        <h3 className="text-2xl font-bold text-slate-800">Premium</h3>
                        <span className="plan-pill bg-orange-100 text-orange-700">Pro</span>
                      </div>
                      <p className="text-slate-500 mb-4 text-sm">Full access with priority support</p>
                      <div className="mb-2">
                        <span className="text-4xl font-extrabold text-slate-900">{tierPrices.premium ?? '—'}</span>
                        {tierPrices.premium && <span className="text-lg text-slate-500 ml-2">ETH</span>}
                      </div>
                      <p className="text-xs text-slate-400 mb-6">30 days · renew anytime</p>
                      <ul className="space-y-2 mb-8">
                        <PremiumFeatureItem text="Everything in Basic" />
                        <PremiumFeatureItem text="Priority on-chain verification" />
                        <PremiumFeatureItem text="Advanced analytics & reports" />
                        <PremiumFeatureItem text="Priority support (24/7)" />
                        <PremiumFeatureItem text="Early access to new features" />
                        <PremiumFeatureItem text="Premium badge on-chain" />
                      </ul>
                      {!subscriptionStatus?.isActive ? (
                        <button
                          onClick={() => handleSubscribe(1)}
                          disabled={loading || !networkMatches || !backend.contractReady || !tierPrices.premium || !pricesReady}
                          className="subscribe-btn w-full bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600"
                        >
                          {loading ? 'Processing…' : 'Subscribe — Premium'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRenew(1)}
                          disabled={loading || !networkMatches || !backend.contractReady || !tierPrices.premium || !pricesReady}
                          className="renew-btn w-full"
                        >
                          {loading ? 'Processing…' : 'Renew — Premium'}
                        </button>
                      )}
                    </div>

                  </div>
                )}
              </div>
            )}

            {/* ── Connect CTA (no wallet) ──────────────────────────────────────── */}
            {!account && (
              <div className="card mb-8 text-center py-16">
                <div className="text-6xl mb-4">🔗</div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">Connect Your Wallet</h2>
                <p className="text-slate-500 mb-6 max-w-md mx-auto">
                  Connect MetaMask to subscribe, renew, or manage your on-chain membership.
                </p>
                <button
                  onClick={connectWallet}
                  disabled={loading || !walletAvailable}
                  className="wallet-connect-btn mx-auto"
                >
                  <WalletIcon />
                  {loading ? 'Connecting…' : walletAvailable ? 'Connect MetaMask' : 'MetaMask Not Installed'}
                </button>
                {!walletAvailable && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs text-slate-400">
                      Install{' '}
                      <a href="https://metamask.io" target="_blank" rel="noreferrer" className="text-cyan-600 underline">
                        MetaMask <ExternalLinkIcon />
                      </a>{' '}
                      to use this dApp.
                    </p>
                    <button
                      onClick={() => syncWalletProvider(true)}
                      className="secondary-action-btn w-auto px-4 py-2 mx-auto"
                    >
                      Retry Wallet Detection
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* HISTORY TAB                                                           */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'history' && (
          <div className="card mb-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">Transaction History</h2>
                <p className="text-sm text-slate-500">Latest 20 transactions (local + backend)</p>
              </div>
              <div className="flex gap-2">
                {account && (
                  <button
                    onClick={() => syncTransactionsFromBackend(account, true)}
                    disabled={txSyncing}
                    className="secondary-action-btn w-auto px-4 py-2 flex items-center gap-1.5"
                  >
                    <RefreshIcon spinning={txSyncing} />
                    Sync
                  </button>
                )}
                <button onClick={clearTxHistory} className="secondary-action-btn w-auto px-4 py-2 text-rose-600 border-rose-200 hover:bg-rose-50">
                  Clear
                </button>
              </div>
            </div>

            {txSyncing && transactions.length === 0 ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 w-full" />)}
              </div>
            ) : transactions.length === 0 ? (
              <div className="empty-state">No transactions yet. Make a subscription action to see records here.</div>
            ) : (
              <div className="space-y-3">
                {transactions.map((tx) => (
                  <div key={tx.id} className="tx-row">
                    <div className="min-w-0 flex-1">
                      <p className="tx-title">
                        {tx.type}{tx.tier ? ` · ${tx.tier}` : ''}
                        {tx.amount ? <span className="ml-2 text-slate-500 font-normal">{tx.amount}</span> : null}
                      </p>
                      <p className="tx-meta">{tx.timestamp ? formatPreciseDateTime(tx.timestamp) : 'Unknown time'}</p>
                      {tx.hash && (
                        <p className="tx-meta font-mono">
                          {shortenAddress(tx.hash)}
                          {tx.blockNumber && <span className="ml-2">· Block #{tx.blockNumber}</span>}
                        </p>
                      )}
                      {tx.error && <p className="text-xs text-red-600 mt-1 truncate">{tx.error}</p>}
                    </div>
                    <span className={`tx-status ${tx.status}`}>{tx.status}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Summary row */}
            {transactions.length > 0 && (
              <div className="mt-6 pt-4 border-t border-slate-200 grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-slate-800">{transactions.length}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Total</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-600">{confirmedCount}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Confirmed</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-800">{totalEthSpent} ETH</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Spent</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <footer className="text-center text-xs text-slate-400 pb-8 space-y-1">
          <p>SubChain · Decentralised Subscription Service</p>
          <p>Contract: <span className="font-mono">{shortenAddress(effectiveContractAddress)}</span></p>
        </footer>
      </div>

      {/* ── Unsubscribe confirmation modal ──────────────────────────────────── */}
      {showUnsubscribeConfirm && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsub-title"
        >
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl animate-fade-in">
            <div className="text-4xl mb-4 text-center">⚠️</div>
            <h3 id="unsub-title" className="text-2xl font-bold text-slate-900 mb-2 text-center">
              Cancel Subscription?
            </h3>
            <p className="text-slate-600 mb-6 text-center text-sm">
              You will lose access immediately and no refund will be issued. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowUnsubscribeConfirm(false)}
                className="flex-1 px-4 py-3 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-xl transition"
              >
                Keep Subscription
              </button>
              <button
                onClick={async () => {
                  setShowUnsubscribeConfirm(false);
                  await handleUnsubscribe();
                }}
                disabled={loading || !networkMatches}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition disabled:opacity-50"
              >
                {loading ? 'Cancelling…' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
