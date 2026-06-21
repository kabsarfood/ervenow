# LPG Settlement Verification Report

**Generated:** 2026-06-21T09:55:12.385Z

## Scenario

1000 liters × 1 SAR/L = **1000 SAR**

## Verification Table

| البند | القيمة (SAR) |
| ----- | ------------ |
| Customer Price / L | 1 |
| Total Amount | 1000 |
| Provider Net | 930 |
| Platform Commission | 70 |
| Ledger Credit (after fix) | 930 |
| Legacy bug (credit = total) | 1000 |

## Decision

**Option A — Ledger Credit = Provider Net**

Platform commission (70 SAR) is retained implicitly — customer pays 1000, provider wallet receives 930.

## Proof

```json
{
  "resolveProviderCreditAmount": 930,
  "rpc_call": [
    "ervenow_ledger_credit",
    {
      "p_user_id": "provider-verify",
      "p_amount": 930,
      "p_reference": "verify-central-1000",
      "p_role": "service",
      "p_reference_suffix": "provider_credit"
    }
  ],
  "credit_row": {
    "ok": true,
    "reason": "inserted",
    "amount": 930,
    "credit_basis": "provider_net"
  },
  "option_a_expected": 930,
  "option_b_not_used": "Split ledger entries deferred — Option A adopted"
}
```

## Verdict

**PASS**
