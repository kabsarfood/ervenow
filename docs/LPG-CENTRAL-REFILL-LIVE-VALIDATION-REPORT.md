# LPG Central Refill Live Validation Report

**Generated:** 2026-06-21T06:51:06.349Z

## Verdict

**PASS**

## Provider

```json
{
  "id": "45eee92d-9889-4a02-9bb9-100db6d5f626",
  "role": "service",
  "service_type": "gas_central_refill",
  "status": "approved",
  "phone": "966509998001",
  "lat": 24.7136,
  "lng": 46.6753
}
```

## Order

`bbe00803-6b04-4eb6-9199-28473b0157ad`

## Validation Checks

| # | Check | Result |
|---|-------|--------|
| 1_create_refill_order | PASS |
| 2_visible_to_provider | PASS |
| 3_accept | PASS |
| 4_start_refill | PASS |
| 5_record_actual_liters | PASS |
| 6_finish_task | PASS |
| 7_settlement | PASS |
| 8_wallet_credit | PASS |
| 9_notifications | PASS |

## Steps

- **1_create_refill_order** → order bbe00803-6b04-4eb6-9199-28473b0157ad, gas_mode=central_refill, 1000L, total=900
- **2_visible_to_provider** → yes
- **3_accept** → accepted
- **4_start_refill** → delivering
- **5_record_actual_liters** → 1000 L
- **6_finish_task** → delivered
- **7_settlement** → credit=837, expected=837, total=900
- **8_wallet_credit** → before=837, after=1674, delta=837
- **9_notifications** → count=1

## Proofs

```json
{
  "portal_type": "service",
  "visible_service": true,
  "gas_mode": "central_refill",
  "gas_liters": 1000,
  "actual_liters_delivered": 1000,
  "total_amount": 1035,
  "platform_commission": 63,
  "provider_net": 837,
  "ledger_credit": 837,
  "expected_credit": 837,
  "wallet": {
    "before": 837,
    "after": 1674,
    "delta": 837
  },
  "notifications_count": 1,
  "provider_credit": {
    "ok": true,
    "reason": "inserted",
    "amount": 837,
    "credit_basis": "provider_net"
  }
}
```

