# ERVENOW — Routing Validation Report (G1-R Final)

Generated: 2026-06-21T12:19:05.040Z

**Status: PASS**

## Summary

- Order routing: 15/15
- Provider routing: 8/8
- Transport exclusions: 5/5

## Final Decisions

| Item | Portal |
|------|--------|
| Gas (غاز) | **Service** |
| Internal delivery (توصيل داخلي) | **Driver** |
| Transport | سطحة · نقل مركبات · نقل أثاث فقط |

## Order Routing Matrix

| Label | order_type | service_type | Expected | Resolved | Visible | Pass |
|-------|------------|--------------|----------|----------|---------|------|
| مطعم | restaurant | — | merchant | merchant | true | ✓ |
| متجر | store | — | merchant | merchant | true | ✓ |
| سباك | service | plumber | service | service | true | ✓ |
| كهربائي | service | electrician | service | service | true | ✓ |
| تكييف | service | ac_technician | service | service | true | ✓ |
| غسيل | service | laundry_estates | service | service | true | ✓ |
| تشجير | service | agricultural_engineer | service | service | true | ✓ |
| تلميع مركبات | service | car_polishing | service | service | true | ✓ |
| غاز | gas_delivery | gas_delivery | service | service | true | ✓ |
| توصيل داخلي | service | internal_delivery | driver | driver | true | ✓ |
| طلب جاهز للتوصيل | restaurant | — | driver | merchant | true | ✓ |
| سطحة | service | pickup_truck | transport | transport | true | ✓ |
| نقل مركبة | service | car_transport | transport | transport | true | ✓ |
| نقل مركبة | service | vehicle_transfer | transport | transport | true | ✓ |
| نقل أثاث | service | furniture_move | transport | transport | true | ✓ |

## Provider Account Routing

| role | service_type | Expected | Resolved | Pass |
|------|--------------|----------|----------|------|
| service | plumber | service | service | ✓ |
| service | gas_cylinder_swap | service | service | ✓ |
| service | car_polishing | service | service | ✓ |
| service | gas_delivery | service | service | ✓ |
| service | pickup_truck | transport | transport | ✓ |
| service | internal_delivery | driver | driver | ✓ |
| driver | — | driver | driver | ✓ |
| store | — | merchant | merchant | ✓ |

## Removed from Transport Portal

- `internal_delivery`: transport=false, service=false, driver=true → OK
- `gas_delivery`: transport=false, service=true, driver=false → OK
- `gas_cylinder_swap`: transport=false, service=true, driver=false → OK
- `gas_central_refill`: transport=false, service=true, driver=false → OK
- `car_polishing`: transport=false, service=true, driver=false → OK

## Taxonomy Sets

```json
{
  "order_portal_types": [
    "merchant",
    "service",
    "transport",
    "driver"
  ],
  "service_portal_types": [
    "ac_technician",
    "agricultural_engineer",
    "car_polishing",
    "electrician",
    "gas_central_refill",
    "gas_cylinder_swap",
    "gas_delivery",
    "laundry_estates",
    "plumber"
  ],
  "transport_portal_types": [
    "car_transport",
    "furniture_move",
    "pickup_truck",
    "vehicle_transfer"
  ],
  "driver_portal_types": [
    "internal_delivery"
  ]
}
```
