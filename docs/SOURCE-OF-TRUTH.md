# ERVENOW — Source of Truth (مصدر الحقيقة الواحد)

وثيقة حيّة: تُحدَّث مع مراحل CONSOLIDATION. الهدف تقليل التفرّع بين مسارات API وواجهات متعددة.

| المجال | المصدر الرسمي الوحيد (SoT) | ملاحظات / مسارات بديلة (تدريجي) |
|--------|------------------------------|-----------------------------------|
| **إنشاء طلب توصيل (بدون سلة)** | منطق `apps/order/deliveryOrderCreateShared.js` — يستدعيه `POST /api/order/create` و`POST /api/delivery/orders` | الواجهات الحالية تبقى على نفس URLs؛ المنطق الداخلي موحّد. |
| **إنشاء طلب مع سلة** | `POST /api/checkout` → `apps/checkout/service.js` | يُستدعى أيضاً من `POST /api/order/create` عند وجود `items`. |
| **إنشاء طلب «مالي» عام (أدوات/تكامل)** | `POST /api/finance/orders` — ليس بديل التوصيل للعميل | للإدارة/التكامل؛ لا يُستخدم كمسار واجهة عميل رئيسي. |
| **جدول طلبات التشغيل** | `public.orders` | `delivery_status` + `status` — راجع `docs/order-lifecycle.md`. |
| **تتبع خريطة + حالة** | `GET /api/delivery/orders/:id` + صفحة `/track` + Socket.IO (`shared/lib/trackingSocket.js`) | `delivery/map.html` يعيد التوجيه إلى `/track`. |
| **رصيد تشغيلي (مندوب/تاجر خدمة/عميل حسب الدور)** | `POST/GET /api/wallet/*` + جداول `ervenow_*` (انظر `docs/wallet-system.md`) | — |
| **سحب تشغيلي (OTP)** | `POST /api/wallet/withdraw/send-otp` + `confirm-otp` + `ervenow_withdraw_requests` | — |
| **سحب متجر** | `GET/POST /api/store/withdrawals` + `store_withdrawals` + RPC المتجر | موافقة إدارية عبر مسارات `admin` (تسميات متعددة — مرحلة توحيد لاحقة). |
| **محاسبة قديمة / تسوية** | `wallets`, `wallet_transactions`, `withdrawals` + `apps/finance/walletService.js` | تدريجياً: قراءة/تقارير فقط أو دمج مع طبقة التشغيل. |
| **خادم محفظة منفصل (legacy)** | `apps/finance/wallet-server.js` — **ليس SoT** | لا يُشغَّل في production بدون `ERVENOW_WALLET_STANDALONE_SERVER=1`؛ بدون JWT — داخلي/تطوير فقط. |
| **OTP** | `shared/services/otpChallengeService.js` + scopes (`CORE_LOGIN`, `DRIVER_LOGIN`, `WALLET_WITHDRAW`) | نقاط الدخول: `/api/core/*` و`/api/driver/*` و`/api/wallet/withdraw/*`. |
| **حالة المندوب على الطلب** | `orders.driver_id`, `orders.delivery_status` + انتقالات `shared/utils/deliveryStateMachine.js` | تحديث عبر `PATCH /api/delivery/orders/:id/status` وغيره. |
| **إشعارات (واتساب/قوالب)** | `shared/services/whatsappService.js` + `shared/messages/*` | — |
| **واجهة ثابتة منشورة** | `public/*` عند تفعيل `servePublicUi` في `server/server.js` | `ervenow-frontend/*` نسخة مزامنة — مصدر منطقي واحد في CI/سكربت المزامنة. |

## مرحلة التوحيد الحالية (طلب توصيل)

- **SoT للكود:** `runUnifiedDeliveryOnlyCreate` في `apps/order/deliveryOrderCreateShared.js`.
- **توافق خلفي:** عند `entryPoint: "delivery"` يُتجاهل `ERVENOW_REQUIRE_ORDER_PAYMENT` مؤقتاً ليطابق سلوك `POST /api/delivery/orders` السابق. لاحترام بوابة الدفع على واجهات قديمة، يُرحَّب بالتحويل تدريجياً إلى `POST /api/order/create`.

## مرحلة لاحقة (مقترحة)

- توحيد تسمية مسارات الإدارة للسحب تحت `/api/admin/finance/*`.
- دمج واجهات المندوب (`driver.html` + `driver-dashboard.html` + `driver-wallet.html`) في تجربة واحدة مع إعادة توجيه 302 تدريجية.
