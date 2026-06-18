# ERVENOW — Notification Audit Report

> Generated: 2026-06-17T09:15:02.559Z
> Source: `shared/services/notificationEvents.js` → `NOTIFICATION_EVENT_CATALOG`
> Engine: `createRoutedNotification` via Notification Routing (Flow Separation 3.0)

جميع الإشعارات التشغيلية تمر عبر `target_portal` + `target_role` + `event` في الـ payload.

| Event | Portal | Recipient | Route |
| ----- | ------ | --------- | ----- |
| `merchant.order.new` | merchant | merchant | checkout/service · unifiedOrderStatus |
| `merchant.order.cancelled` | merchant | merchant | delivery/cancel · unifiedOrderStatus |
| `merchant.withdraw.approved` | merchant | merchant | admin/withdrawals approve |
| `merchant.withdraw.rejected` | merchant | merchant | admin/withdrawals reject |
| `driver.order.ready` | driver | driver | unifiedOrderStatus READY · driver/notify |
| `driver.task.assigned` | driver | driver | admin/assign · delivery/accept |
| `driver.task.cancelled` | driver | driver | delivery/cancel · unifiedOrderStatus |
| `driver.withdraw.approved` | driver | driver | admin/withdrawals approve |
| `driver.withdraw.rejected` | driver | driver | admin/withdrawals reject |
| `service.request.new` | service | service | serviceBookingNotify · unifiedOrderStatus |
| `service.schedule.updated` | service | service | order/:id/details patch |
| `service.order.cancelled` | service | service | delivery/cancel · unifiedOrderStatus |
| `service.withdraw.approved` | service | service | admin/withdrawals approve |
| `service.withdraw.rejected` | service | service | admin/withdrawals reject |
| `transport.request.new` | transport | transport | carTransportNotify · unifiedOrderStatus |
| `transport.destination.updated` | transport | transport | order/:id/details patch |
| `transport.task.cancelled` | transport | transport | delivery/cancel · unifiedOrderStatus |
| `transport.withdraw.approved` | transport | transport | admin/withdrawals approve |
| `transport.withdraw.rejected` | transport | transport | admin/withdrawals reject |
| `driver.payment.settled` | driver | driver | unifiedOrderStatus DELIVERED settlement |
| `service.payment.settled` | service | service | unifiedOrderStatus DELIVERED settlement |
| `transport.payment.settled` | transport | transport | unifiedOrderStatus DELIVERED settlement |
| `wallet.topup` | * | * | wallet/topup-request · redeem-code · ledger/deposit |
| `wallet.refund` | * | * | wallet/ledger/refund |
| `account.lifecycle` | * | * | admin/account lifecycle |
| `customer.order.received` | customer | customer | deliveryOrderCreateShared |
| `customer.order.accepted` | customer | customer | unifiedOrderStatus · delivery/accept |
| `customer.order.in_progress` | customer | customer | unifiedOrderStatus PREPARING |
| `customer.driver.en_route` | customer | customer | unifiedOrderStatus DELIVERING |
| `customer.order.delivered` | customer | customer | unifiedOrderStatus DELIVERED |
| `customer.order.cancelled` | customer | customer | delivery/cancel · unifiedOrderStatus |
| `customer.schedule.updated` | customer | customer | order/:id/details patch |
| `customer.destination.updated` | customer | customer | order/:id/details patch |

## Portal coverage

| Portal | Events |
| ------ | ------ |
| merchant | 4 |
| driver | 6 |
| service | 6 |
| transport | 6 |
| customer | 8 |
| cross-portal | 3 |

## Verification

```bash
npm test -- --testPathPattern="notificationEvents|notificationPortalRouting"
node scripts/generate-notification-audit-report.js
```
