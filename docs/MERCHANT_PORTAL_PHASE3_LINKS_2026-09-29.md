# المرحلة 3 — تنظيف روابط التاجر — 2026-09-29

المراحل 1 و2 معتمدة. المسار الرسمي الوحيد للتشغيل: `/merchant-dashboard`.
لم يُحذف `order-board.html` / `order-board.js` / `store-dashboard.html` / `merchant-preview.html`.

## الروابط التي تغيرت

الملف | القديم | الجديد
public/index.html | /store-dashboard#wallet | /merchant-dashboard#wallet
public/assets/store-shell.js | /order-board | /merchant-dashboard#orders
public/assets/store-shell.js | لوحة المتجر بدون هاش | /merchant-dashboard#home
public/assets/store-shell.js | #walletAnchor في الهيدر | /merchant-dashboard#wallet
data/portal-launch.json operational_paths.merchant | /merchant-preview | /merchant-dashboard
shared/utils/adminRoleTaxonomy.js paths | ترتيب قديم أولاً | /merchant-dashboard أولاً
public/merchant-pos-sw.js fallback | /merchant-preview | /merchant-dashboard
tests/e2e/core-validation.spec.js و reconnect-lifecycle.spec.js | /merchant-preview#… | /merchant-dashboard#…

## Redirects المفعلة

- GET /order-board و /order-board.html (Express، قبل static) → /merchant-dashboard + query + #orders
- سكربت في order-board.html (استضافة static) → نفس الوجهة
- فتح /store-dashboard#wallet أو #walletAnchor (سكربت + hashchange) → /merchant-dashboard#wallet مع الحفاظ على query
- لا redirect لكامل /store-dashboard
- لا redirect لـ /merchant-preview في هذه المرحلة
- لا حلقة: الوجهة هي /merchant-dashboard فقط

## الروابط Legacy الباقية (ولماذا)

- /store-dashboard بدون هاش محفظة: صفحة legacy كاملة حتى Audit المرحلة التالية
- عناصر #walletAnchor داخل store-dashboard.html: معرّفات DOM؛ الضغط عليها يحوّل للمحفظة الرسمية
- /merchant-preview.html: توافق مؤقت، يُخدم من السيرفر، ليس رابط تشغيل جديد
- merchant-preview.js currentPortalPath: عندما تكون أصلاً على تلك الصفحة (hashBase)
- login.html قائمة guarded: حتى تبقى حماية الجلسة على الصفحات القديمة إن فُتحت
- form-draft.js: استثناء مسارات قديمة لمسودات النماذج
- PORTAL_LEGACY_PATHS.merchant = /store-dashboard: مرجع توافق فقط
- GET /api/store/order-board: عقد API وليس صفحة
- role-context walletAnchor: alias هاش داخلي لـ #wallet في PortalShell
- bannerTargets/bannerPlacements page=/store-dashboard: استهداف إعلانات للصفحة القديمة التي ما زالت تُفتح
- restaurant-dashboard → /store-dashboard: سلسلة قديمة قائمة مسبقاً (لم نوسّعها هنا)
- data/admin-readiness.json redirect_events: سجل تاريخي
- docs/ و scripts/typography*: توثيق أو التقاط شاشة للوحة القديمة

## PORTAL_LEGACY_PATHS

ما زال الثابت موجوداً: merchant → /store-dashboard.
portalPathForRole لا يستخدمه للتاجر أبداً (حتى لو PORTAL_LIVE.merchant أصبح false).
الوجهة الحية: OPERATIONAL_PORTAL_PATHS.merchant = /merchant-dashboard (+ #home بعد الدخول).

## اختبار التنقل

- /order-board.html → /merchant-dashboard#orders (تحقق متصفح)
- /store-dashboard.html#wallet → /merchant-dashboard#wallet
- /store-dashboard.html#walletAnchor → /merchant-dashboard#wallet
- /store-dashboard.html بدون هاش محفظة: لا يُحوَّل للبوابة (قد يذهب لـ /login إن لم توجد جلسة — حماية حساب لا Redirect تشغيلي)
- /merchant-dashboard#orders و #wallet: لا حلقة

## قرار store-dashboard

بقي مؤقتاً. لا حذف ولا تحويل كامل. المرحلة التالية: Audit وظائفه مقابل PortalShell ثم القرار.
