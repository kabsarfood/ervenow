# المرحلة 1 — تثبيت PortalShell على /merchant-dashboard — 2026-09-29

لا حذف، لا Redirect لـ order-board / store-dashboard / merchant-preview.

## التطبيق الواحد
- `merchant-preview.js` + PortalShell هما التطبيق الوحيد.
- `/merchant-dashboard.html` و `/merchant-preview.html` يستدعيان `ErvenowMerchantPreview.init()`.
- `hashBase` = المسار الحالي (`/merchant-dashboard` أو `/merchant-preview`).
- الروابط الرسمية الجديدة (هيدر/محفظة/دخول) تشير إلى `/merchant-dashboard#…`.

## الهاش
Canonical: home, orders, store, products, pos, wallet, employees, reports, settings.
Aliases: dashboard→home, walletAnchor/withdrawals→wallet, store-admin/visitor-preview→store, categories/offers→products, cashiers→employees, complete→settings, expenses→reports.
Extra بدون قائمة: reviews, notifications.
