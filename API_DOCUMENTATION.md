# Subscription DApp - API Documentation

## Base URL
```
http://localhost:3003/api
```

## Table of Contents
- [Health & Status](#health--status)
- [Subscription Management](#subscription-management)
- [Transactions](#transactions)
- [Statistics & Analytics](#statistics--analytics)
- [Cache Management](#cache-management)
- [Reminders](#reminders)

---

## Health & Status

### GET /health
Check backend service health and contract connection status.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "service": "subscription-backend",
  "version": "1.0.0",
  "contractConfigured": true,
  "contractReady": true,
  "chainId": 1337,
  "contractAddress": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "rpcUrl": "http://127.0.0.1:8545",
  "startupError": null,
  "transactionRecords": 15,
  "cacheSize": 5,
  "eventListenerActive": true,
  "uptime": 3600.5
}
```

### GET /config
Get contract configuration details.

**Response:**
```json
{
  "contractAddress": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "rpcUrl": "http://127.0.0.1:8545",
  "chainId": 1337,
  "contractReady": true
}
```

---

## Subscription Management

### GET /status/:address
Get subscription status for a specific address.

**Parameters:**
- `address` (path) - Ethereum address

**Response:**
```json
{
  "address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "isActive": true,
  "expiry": "1705401600",
  "tier": 1,
  "expiryDate": "2024-01-16T10:00:00.000Z",
  "timeRemaining": 86400,
  "daysRemaining": 1,
  "tierPrices": {
    "basic": "0.01",
    "premium": "0.025"
  }
}
```

**Error Responses:**
- `400` - Invalid Ethereum address
- `503` - Contract not ready

---

## Transactions

### GET /transactions/:address
Get transaction history for a specific address.

**Parameters:**
- `address` (path) - Ethereum address
- `limit` (query, optional) - Number of transactions to return (default: 20, max: 100)

**Example:**
```
GET /transactions/0x70997970C51812dc3A010C7d01b50e0d17dc79C8?limit=10
```

**Response:**
```json
{
  "address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "count": 3,
  "transactions": [
    {
      "id": "1705315200000-abc123",
      "clientId": "1705315200000-abc123",
      "hash": "0x1234567890abcdef...",
      "address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "type": "Subscribe",
      "tier": "Premium",
      "amount": "0.025 ETH",
      "status": "confirmed",
      "error": null,
      "chainId": 1337,
      "blockNumber": 12345,
      "createdAt": "2024-01-15T10:00:00.000Z",
      "updatedAt": "2024-01-15T10:00:30.000Z"
    }
  ]
}
```

### POST /transactions
Create or record a new transaction.

**Request Body:**
```json
{
  "hash": "0x1234567890abcdef...",
  "clientId": "1705315200000-abc123",
  "address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "type": "Subscribe",
  "tier": "Premium",
  "amount": "0.025 ETH",
  "status": "pending",
  "chainId": 1337
}
```

**Response:**
```json
{
  "message": "Transaction recorded",
  "transaction": {
    "id": "1705315200000-abc123",
    "hash": "0x1234567890abcdef...",
    "status": "pending",
    "createdAt": "2024-01-15T10:00:00.000Z"
  }
}
```

**Error Responses:**
- `400` - Missing hash or clientId
- `400` - Invalid Ethereum address

### PATCH /transactions/:id
Update an existing transaction.

**Parameters:**
- `id` (path) - Transaction ID, hash, or clientId

**Request Body:**
```json
{
  "status": "confirmed",
  "blockNumber": 12345,
  "error": null
}
```

**Response:**
```json
{
  "message": "Transaction updated",
  "transaction": {
    "id": "1705315200000-abc123",
    "status": "confirmed",
    "blockNumber": 12345,
    "updatedAt": "2024-01-15T10:00:30.000Z"
  }
}
```

**Error Responses:**
- `404` - Transaction not found

---

## Statistics & Analytics

### GET /stats
Get overall platform statistics.

**Response:**
```json
{
  "contractAddress": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "network": "http://127.0.0.1:8545",
  "chainId": 1337,
  "tierPrices": {
    "basic": "0.01",
    "premium": "0.025"
  },
  "subscriptionDuration": "30 days",
  "supportedTiers": ["Basic (0)", "Premium (1)"],
  "totalSubscribers": 25,
  "activeSubscribers": 18,
  "totalRevenue": "0.425",
  "lastUpdated": "2024-01-15T10:30:00.000Z",
  "cacheSize": 18,
  "transactionCount": 45
}
```

### GET /analytics
Get detailed analytics and breakdowns.

**Response:**
```json
{
  "overview": {
    "totalTransactions": 45,
    "totalSubscribers": 25,
    "activeSubscribers": 18,
    "totalRevenue": "0.425"
  },
  "transactionBreakdown": {
    "byType": {
      "Subscribe": 25,
      "Renew": 15,
      "Unsubscribe": 5
    },
    "byStatus": {
      "confirmed": 42,
      "pending": 1,
      "failed": 2
    }
  },
  "revenueBreakdown": {
    "byTier": {
      "Basic": 0.15,
      "Premium": 0.275
    },
    "total": "0.425"
  },
  "recentActivity": {
    "last24Hours": 8,
    "transactions": [
      {
        "type": "Subscribe",
        "status": "confirmed",
        "tier": "Premium",
        "timestamp": "2024-01-15T09:45:00.000Z"
      }
    ]
  },
  "cacheMetrics": {
    "size": 18,
    "ttl": 30000
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## Cache Management

### POST /cache/clear
Clear subscription cache.

**Request Body (Optional):**
```json
{
  "address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
}
```

**Response (Single Address):**
```json
{
  "message": "Cache cleared for 0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Response (All Cache):**
```json
{
  "message": "All cache cleared",
  "clearedEntries": 18,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `400` - Invalid Ethereum address

---

## Reminders

### POST /reminder
Check for expiring subscriptions.

**Request Body:**
```json
{
  "addresses": [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
  ]
}
```

**Response:**
```json
{
  "message": "Reminder check completed",
  "expiringSubscriptions": [
    {
      "address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "expiry": "1705401600",
      "tier": 1,
      "tierName": "Premium",
      "expiryDate": "2024-01-16T10:00:00.000Z",
      "daysUntilExpiry": 1,
      "hoursUntilExpiry": 24
    }
  ],
  "totalExpiring": 1,
  "checkedAddresses": 2,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `400` - Addresses must be an array
- `503` - Contract not ready

---

## Error Handling

All endpoints follow a consistent error response format:

```json
{
  "error": "Error message",
  "details": "Detailed error information"
}
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (invalid input)
- `404` - Not Found
- `500` - Internal Server Error
- `503` - Service Unavailable (contract not ready)

---

## Rate Limiting

Currently no rate limiting is implemented. For production:
- Recommended: 100 requests per minute per IP
- Use middleware like `express-rate-limit`

---

## Caching

### Subscription Data Cache
- **TTL:** 30 seconds
- **Purpose:** Reduce blockchain RPC calls
- **Invalidation:** Automatic on contract events (Subscribe, Renew, Unsubscribe)

### Cache Cleanup
- **Schedule:** Every hour
- **Removes:** Entries older than 5 minutes

---

## Event Listeners

The backend automatically listens for smart contract events:

### Subscribed Event
```javascript
event Subscribed(address indexed user, uint256 expiry, Tier tier, uint256 amount)
```
- Clears user cache
- Updates statistics
- Records transaction

### Renewed Event
```javascript
event Renewed(address indexed user, uint256 newExpiry, Tier tier, uint256 amount)
```
- Clears user cache
- Updates statistics
- Records transaction

### Unsubscribed Event
```javascript
event Unsubscribed(address indexed user)
```
- Clears user cache
- Updates statistics
- Records transaction

### TierPriceUpdated Event
```javascript
event TierPriceUpdated(Tier indexed tier, uint256 oldPrice, uint256 newPrice)
```
- Logs price change

---

## Scheduled Tasks

### Daily Expiry Check
- **Schedule:** 9:00 AM daily
- **Purpose:** Identify subscriptions expiring within 7 days
- **Output:** Console logs with expiring addresses

### Hourly Cache Cleanup
- **Schedule:** Every hour
- **Purpose:** Remove stale cache entries
- **Output:** Console logs with cleanup stats

---

## WebSocket Support

Currently not implemented. Future enhancement for real-time updates.

---

## Authentication

Currently no authentication required. For production:
- Implement JWT tokens
- Add API key authentication
- Use signature verification for user-specific endpoints

---

## CORS Configuration

Currently allows all origins. For production:
```javascript
app.use(cors({
  origin: ['https://yourdomain.com'],
  credentials: true
}));
```

---

## Testing

### Example cURL Commands

**Health Check:**
```bash
curl http://localhost:3003/api/health
```

**Get Subscription Status:**
```bash
curl http://localhost:3003/api/status/0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

**Get Statistics:**
```bash
curl http://localhost:3003/api/stats
```

**Create Transaction:**
```bash
curl -X POST http://localhost:3003/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "hash": "0x123...",
    "address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "type": "Subscribe",
    "tier": "Basic",
    "amount": "0.01 ETH",
    "status": "pending"
  }'
```

**Clear Cache:**
```bash
curl -X POST http://localhost:3003/api/cache/clear \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Support

For API issues or questions:
- Check backend logs
- Verify contract connection
- Review error responses
- Consult troubleshooting guide
