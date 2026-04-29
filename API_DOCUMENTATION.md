# Subscription DApp - API Documentation

## Base URL
```text
http://localhost:3003/api
```

## Authentication (Webhook Admin Routes)
Webhook management routes are protected when `ADMIN_API_KEY` is set in backend env.

Use this header on admin routes:
```http
x-api-key: <ADMIN_API_KEY>
```

---

## Health & Config

### GET /health
Backend health and runtime status.

Includes:
- contract readiness
- webhook listener status
- webhook record/log counts

### GET /config
Current runtime contract config.

---

## Subscription Data

### GET /status/:address
Get subscription details for one wallet.

Path params:
- `address` (required): EVM address

Returns:
- `isActive`
- `expiry`
- `tier`
- `expiryDate`
- `timeRemaining`
- `tierPrices`

### POST /reminder
Batch check addresses expiring within 7 days.

Body:
```json
{
  "addresses": ["0x...", "0x..."]
}
```

---

## Statistics

### GET /stats
High-level contract/platform stats.

### GET /balance
Contract balance in wei and ETH.

---

## Transactions

### GET /transactions/:address?limit=20
List transactions for one wallet.

### POST /transactions
Create/upsert transaction record.

Body example:
```json
{
  "clientId": "tx-local-123",
  "hash": "0x...",
  "address": "0x...",
  "type": "Subscribe",
  "tier": "Basic",
  "amount": "0.01 ETH",
  "status": "pending",
  "chainId": 1337
}
```

### PATCH /transactions/:id
Update transaction status/details.

Body example:
```json
{
  "status": "confirmed",
  "blockNumber": 123,
  "error": null
}
```

---

## Webhooks

Supported contract events:
- `Subscribed`
- `Renewed`
- `Unsubscribed`
- `Withdrawn`
- `TierPriceUpdated`
- `SubscriptionExpired`

### GET /webhooks/summary
Admin route. Returns counts and recent delivery success/failure summary.

### POST /webhooks
Admin route. Register webhook endpoint.

Body example:
```json
{
  "url": "https://example.com/subscription-events",
  "events": ["Subscribed", "Renewed", "Unsubscribed"],
  "secret": "optional-endpoint-secret",
  "description": "Billing service"
}
```

### GET /webhooks
Admin route. List all registered webhooks.

### PATCH /webhooks/:id
Admin route. Update webhook.

Body example:
```json
{
  "active": false,
  "events": ["Subscribed", "Renewed"]
}
```

### DELETE /webhooks/:id
Admin route. Delete webhook.

### POST /webhooks/:id/test
Admin route. Sends a `ManualTest` delivery to that webhook.

### GET /webhooks/logs?limit=50&webhookId=<id>&status=success
Admin route. Delivery logs with optional filters.

---

## Webhook Delivery Behavior

- Delivery method: HTTP `POST` with JSON body
- Retry strategy: exponential backoff
- Attempt count: `WEBHOOK_MAX_ATTEMPTS`
- Timeout per request: `WEBHOOK_TIMEOUT_MS`

Delivery headers:
- `x-webhook-id`
- `x-webhook-event`
- `x-webhook-event-id`
- `x-webhook-timestamp`
- `x-webhook-signature` (when secret exists)

Signature format:
```text
sha256=<hex-hmac>
```

Signed payload string:
```text
<timestamp>.<eventName>.<rawJsonPayload>
```

Hash algorithm: HMAC-SHA256.

---

## Error Format

```json
{
  "error": "Error message",
  "details": "Optional details"
}
```

Common statuses:
- `200` success
- `201` created
- `400` bad request
- `401` unauthorized (admin routes)
- `404` not found
- `429` rate limited
- `500` server error
- `503` contract/runtime not ready
