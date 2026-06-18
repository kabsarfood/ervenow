# ERVENOW Flow Separation 3.0

**التاريخ:** 17 يونيو 2026  
**الحالة:** المرحلة 1–4 — محركات التوجيه (JS) + migration SQL

---

## الهدف

فصل الطلبات والإشعارات والعمليات المالية بحيث يصل كل شيء للجهة الصحيحة فقط — بعد اعتماد البوابات الأربع.

---

## المكوّنات الأربعة

| المكوّن | الملف | الوظيفة |
|---------|-------|---------|
| **Order Routing Engine** | `shared/utils/orderPortalRouting.js` | `portal_type` على الطلب + فلترة القوائم |
| **Notification Routing Engine** | `shared/utils/notificationPortalRouting.js` | `target_portal` / `target_role` في payload |
| **Broadcast Engine** | `shared/services/broadcastNotify.js` | جماهير: customers · merchants · drivers · services · transport · all |
| **Wallet Routing Engine** | `shared/utils/walletPortalRouting.js` | ربط السحوبات ببوابة المستخدم |

**تصدير موحّد:** `shared/utils/flowRouting.js`

---

## 1. Order Routing

### portal_type المعتمد

```text
merchant  — مطاعم · متاجر · توصيل
service     — خدمات منزلية
transport   — نقل · سطحات · غاز
```

### الدوال

- `resolveOrderPortalType(order)` — استنتاج من `order_type` + `service_type`
- `applyPortalTypeToOrderRow(row)` — يُطبَّق عند الإنشاء
- `orderVisibleInPortal(order, portal)` — قواعد الظهور
- `filterOrdersForPortal(orders, portal)` — فلترة API

### قواعد الظهور

| portal_type | Merchant | Driver | Service | Transport | Customer |
|-------------|----------|--------|---------|-----------|----------|
| merchant | ✅ | ✅ (توصيل) | ❌ | ❌ | ✅ |
| service | ❌ | ❌ | ✅ | ❌ | ✅ |
| transport | ❌ | ❌ | ❌ | ✅ | ✅ |

### نقاط الربط

- `apps/checkout/service.js`
- `shared/services/serviceOrderCreate.js`
- `apps/delivery/service.js`
- `apps/store/routes.js` (order-board)
- `apps/driver/routes.js`
- `apps/services/routes.js`

### Migration

`shared/migration_orders_portal_type.sql` — عمود `portal_type` + backfill

---

## 2. Notification Routing

### الحقول

```json
{
  "target_portal": "merchant|driver|service|transport|customer|admin",
  "target_role": "...",
  "portal_type": "..."
}
```

### الدوال

- `createRoutedNotification(sb, input)` — إنشاء مع توجيه
- `filterNotificationsForPortal(items, portalContext)` — فلترة حسب البوابة
- `notificationBelongsToPortal(notif, ctx)`

### نقاط الربط

- `apps/notifications/routes.js` — فلترة GET + unread-count
- `shared/services/platformNotify.js` — إشعارات تاجر/مزود/أدمن
- `apps/order/deliveryOrderCreateShared.js` — إشعار العميل

---

## 3. Broadcast Engine

### الجماهير المعتمدة

```text
customers | merchants | drivers | services | transport | all
```

توافق خلفي: `providers` → `services` · `everyone` → `all`

### نقاط الربط

- `shared/services/broadcastNotify.js`
- `public/admin/modules/broadcast.js`

---

## 4. Wallet Routing

### الدوال

- `resolveUserWalletPortal(appUser)` → merchant | driver | service | transport
- `filterWithdrawalsForPortal(rows, portalType)`
- `annotateWithdrawalPortal(row, portalType)`

### نقاط الربط

- `apps/wallet/routes.js` — GET `/withdraw` يُرجع `portal_type`

---

## النتيجة

```
Unified Login Router     → resolvePortalRole + portalLaunch
Order Routing Engine     → orderPortalRouting
Notification Routing     → notificationPortalRouting
Wallet Routing Engine    → walletPortalRouting
Broadcast Engine         → broadcastNotify (جماهير معتمدة)
```

---

## الخطوات التالية

1. ~~تنفيذ `migration_orders_portal_type.sql` في Supabase~~ — `npm run migrate:orders-portal-type`
2. توسيع `createRoutedNotification` في بقية مسارات الإشعار (driver ready، wallet approved)
3. توحيد سحوبات التاجر (`store_withdrawals` + ledger) تحت `walletPortalRouting`
4. فهرس DB على `notifications.payload->>'target_portal'` عند الحاجة
