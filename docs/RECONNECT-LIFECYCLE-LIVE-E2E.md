# Full Live E2E — Store Delivery Lifecycle

**التاريخ:** 2026-06-20T14:04:11.695Z

**الحكم:** **PASS**

**Order:** `9ee77720-408a-4040-95df-7c78ae28d748`

## Steps

- merchant accept → accepted
- merchant preparing → preparing
- merchant ready → ready
- driver accept → picked_up
- delivering → delivering
- delivered → delivered

## Proofs

```json
{
  "order_status": "delivered",
  "wallet_credited_at": null,
  "delivered_at": null,
  "driver_id": "ba07ca03-a6fc-4b18-a9db-8807b1d5dd90",
  "notifications_count": 12,
  "driver_wallet": {
    "before": 477.38,
    "after": 489.38,
    "delta": 12
  }
}
```
