# Orders Schema Consistency Report

Generated: 2026-06-20T14:04:33.994Z

## Summary

| Metric | Value |
|--------|-------|
| Expected columns (platform) | 62 |
| Actual columns (database) | 65 |
| Present & expected | 62 |
| Missing expected | 0 |
| Extra (not in registry) | 3 |
| Schema-cache migration gaps | 0 |
| **Consistent** | **YES** |

## Missing expected columns

_None — all expected columns exist._

## Extra columns (in DB, not in registry)

```
customer_name
date_key
hijri_date
```

## Actual columns

| Column | Type | Nullable |
|--------|------|----------|
| id | uuid | no |
| order_number | text | yes |
| customer_name | text | yes |
| customer_phone | text | yes |
| total_amount | numeric | yes |
| delivery_fee | numeric | yes |
| status | text | yes |
| data | jsonb | yes |
| created_at | timestamp without time zone | yes |
| updated_at | timestamp without time zone | yes |
| series_source | text | yes |
| date_key | date | yes |
| hijri_date | text | yes |
| driver_id | uuid | yes |
| delivery_status | text | yes |
| customer_id | uuid | yes |
| distance_km | numeric | yes |
| driver_lat | numeric | yes |
| driver_lng | numeric | yes |
| last_location_at | timestamp with time zone | yes |
| external_order_id | text | yes |
| pickup_address | text | yes |
| drop_address | text | yes |
| pickup_lat | numeric | yes |
| pickup_lng | numeric | yes |
| drop_lat | numeric | yes |
| drop_lng | numeric | yes |
| notes | text | yes |
| platform_fee | numeric | yes |
| order_total | numeric | yes |
| driver_earning | numeric | yes |
| vat_amount | numeric | yes |
| total_with_vat | numeric | yes |
| rating | integer | yes |
| review | text | yes |
| invoice_number | text | yes |
| invoice_issued_at | timestamp with time zone | yes |
| seller_name | text | yes |
| seller_vat_number | text | yes |
| invoice_url | text | yes |
| wallet_credited_at | timestamp with time zone | yes |
| provider_id | uuid | yes |
| service_type | text | yes |
| order_type | text | yes |
| idempotency_key | text | yes |
| portal_type | text | yes |
| store_name | text | yes |
| store_address | text | yes |
| payment_status | text | yes |
| payment_method | text | yes |
| store_id | uuid | yes |
| breakdown | jsonb | yes |
| merchant_id | uuid | yes |
| service_provider_id | uuid | yes |
| delivery_order_id | uuid | yes |
| country_code | text | yes |
| city | text | yes |
| currency_code | text | yes |
| district | text | yes |
| platform_commission | numeric | yes |
| rated_at | timestamp with time zone | yes |
| scheduled_at | timestamp with time zone | yes |
| service_location | text | yes |
| service_name | text | yes |
| delivered_at | timestamp with time zone | yes |
