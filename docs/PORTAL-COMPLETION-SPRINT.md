# ERVENOW — Portal Completion Sprint

> Completed: 2026-06-17

## Summary

All four operational portals are now **live** (`merchant` + `driver` launched). Empty sections and redirect-only notifications replaced with working in-portal features.

| Portal | Status | Key deliverables |
| ------ | ------ | ---------------- |
| **Merchant** | ✅ Live | Categories CRUD + reorder, Withdrawals, in-portal notifications |
| **Driver** | ✅ Live | `/api/driver/earnings`, in-portal notifications |
| **Service** | ✅ Live | Schedule (today/week, accept/reschedule/cancel), dashboard KPI fix |
| **Transport** | ✅ Live | Fleet, Pricing, gas→transport confirmed |

## Launch

- `shared/utils/portalLaunch.js` — `merchant: true`, `driver: true`
- `data/portal-launch.json` — updated
- Post-login paths → `/merchant-preview`, `/driver-preview`
- Preview banners updated (no longer "draft")

## New APIs

| Endpoint | Purpose |
| -------- | ------- |
| `GET/POST/PUT/DELETE /api/store/merchant-categories` | Merchant category management |
| `PATCH /api/store/merchant-categories/reorder` | Category ordering |
| `GET /api/store/withdrawals` | + balance, available, pending_reserved |
| `GET /api/driver/earnings` | today / week / month + trips + avg |
| `GET /api/core/platform-modules` | Public module status for nav filtering |
| `GET /api/services/me/schedule` | Service schedule |
| `GET /api/services/me/fleet` | Transport fleet |
| `GET /api/services/me/pricing` | Transport pricing reference |

## Platform Modules

New modules in `data/platform-modules.json`:

- `service_schedule` — enabled
- `transport_fleet` — enabled
- `transport_pricing` — enabled
- `ervenow_pos` — disabled (hidden from nav)
- `meshwar` — disabled

Frontend: `portal-platform-modules.js` filters sidebar items when module `disabled`.

## In-portal notifications

- `portal-inline-notifications.js` — embeds `ErvenowNotificationCenter.initPage`
- All four portals: notifications section + header bell (filtered by portal)

## Portal Validation checklist

Per portal, verify manually:

1. **Order** — create/receive booking or store order
2. **Notification** — appears in portal bell + notifications section
3. **Wallet** — balance updates after completion
4. **Withdraw** — merchant/driver withdrawal request (where applicable)
5. **Close** — order reaches delivered/completed state

## Before Meshwar

✅ Merchant complete  
✅ Driver complete  
✅ Service complete  
✅ Transport complete  
⏳ Portal Validation E2E (manual QA on staging/production)  
✅ No empty sidebar sections when modules enabled  
✅ POS hidden while `ervenow_pos: disabled`
