# ERVENOW — Critical Consolidation Phase — تقرير تنفيذي

تاريخ المحتوى: مرحلة 1 منفّذة في الكود كما هو موضّح أدناه.

---

## 1) تنفيذ فعلي (تم)

### أ) `wallet-server.js` — مخاطر وتخفيف

| سؤال | جواب مبني على المستودع |
|------|--------------------------|
| هل يعمل؟ | نعم: ملف Express كامل يستمع عند تشغيل `node apps/finance/wallet-server.js`. |
| هل يُشغَّل بالإنتاج تلقائياً؟ | **لا**: `package.json` → `npm start` يشغّل `server/server.js` فقط؛ لا يوجد script لـ wallet-server. |
| مسارات بدون JWT؟ | نعم: `GET /api/wallet/:userId`, `GET /api/wallet/transactions/:userId`, `POST /api/wallet/withdraw`. |
| الوصول الخارجي؟ | إن نُشر العملية يدوياً على منفذ عام → **خطر حرج** (قراءة رصيد/سحب بمعرّف مستخدم). |

**ما تم:** في `NODE_ENV=production` لا يبدأ الاستماع إلا إذا `ERVENOW_WALLET_STANDALONE_SERVER=1`. عند التفعيل يُستمع افتراضياً على `127.0.0.1` ما لم يُضبط `ERVENOW_WALLET_STANDALONE_HOST`. الملف **لم يُحذف**.

### ب) توحيد إنشاء طلب التوصيل (Proxy داخلي)

| الملف | التغيير |
|--------|---------|
| `apps/order/deliveryOrderCreateShared.js` | **جديد** — منطق موحّد: idempotency، external_order_id، بوابة دفع (حسب المسار)، `createDeliveryOrderFromBody`، enqueue، `bumpDeliveryOrdersListEpoch`. |
| `apps/order/routes.js` | فرع التوصيل يستدعي `runUnifiedDeliveryOnlyCreate` مع `entryPoint: "order"`. |
| `apps/delivery/routes.js` | `POST /orders` يستدعي نفس الدالة مع `entryPoint: "delivery"` + تمرير `X-Source`. |

**توافق خلفي صريح:** مسار `delivery` لا يطبّق `ERVENOW_REQUIRE_ORDER_PAYMENT` بعد (مثل السلوك القديم). مسار `order` يطبّق البوابة كما كان.

### ج) وثائق

| الملف | الغرض |
|--------|--------|
| `docs/SOURCE-OF-TRUTH.md` | جدول المصادر الرسمية + ملاحظات التوحيد. |
| `.env.example` | متغيرات `ERVENOW_WALLET_STANDALONE_*`. |

---

## 2) تحليل endpoints الطلبات (مرجع)

| Endpoint | الجداول / الخدمات | من يستخدمه (واجهات) |
|----------|---------------------|----------------------|
| `POST /api/delivery/orders` | `orders` + طابور `new-order` | `order.html`, `dashboard.html`, `index.html` |
| `POST /api/order/create` | نفس المسار الداخلي للتوصيل؛ أو `checkout` عند `items` | حالياً غير مستخدم من HTML بحث سابق؛ جاهز كـ **Universal entry**. |
| `POST /api/checkout` | `orders` (عبر `runCheckoutInsert`) | `cart.html` |
| `POST /api/finance/orders` | `orders` (إدراج مالي) | تكاملات/أدوات؛ ليس مسار الزائر الافتراضي. |

---

## 3) Driver UI — تحليل (لم يُغيّر HTML)

| الصفحة | الوظيفة الأساسية | APIs شائعة |
|--------|-------------------|------------|
| `driver.html` | لوحة تشغيل كاملة (طلبات، حالة، خريطة، أزرار) | `/api/delivery/*`، روابط `/track` |
| `driver-dashboard.html` | خريطة + قائمة طلبات + Socket | `/driver/assets/app.js`، `/api/delivery/orders` |
| `driver-wallet.html` | رصيد + سحب OTP + سجل | `/api/wallet` ثم احتياط `/api/driver/wallet` |

**خطة دمج لاحقة:** اختيار `driver.html` كـ shell واحد + تبويبات/مسارات فرعية؛ إعادة توجيه تدريجية من `driver-dashboard` و`driver-wallet` مع الحفاظ على الروابط القديمة.

---

## 4) Admin finance — تكرار مسارات (تحليل فقط)

موجود في `apps/admin/routes.js`:

- `GET/POST /withdraws`, `GET /withdrawals/drivers`, `GET /withdrawals/stores`, `POST /withdrawals/:id/approve|reject`, `GET /store-withdrawals`, …

**مقترح namespace لاحق:** `/api/admin/finance/withdrawals/{drivers|stores}/...` مع إبقاء المسارات القديمة كـ thin wrappers.

---

## 5) مخاطر التغيير الحالي

| خطر | التخفيف |
|-----|---------|
| اختلاف سلوك بوابة الدفع بين المسارين | موثّق في SoT؛ المرحلة 2: توحيد السلوك تحت flag. |
| تعطيل wallet-server في production يكسر من يعتمد عليه يدوياً | يضبطون `ERVENOW_WALLET_STANDALONE_SERVER=1` صراحةً. |

---

## 6) ما يُوحَّد أولاً بعد هذه المرحلة

1. إزالة استثناء بوابة الدفع لمسار `delivery` تحت feature flag + تحديث الواجهات.
2. توحيد مسارات admin للسحب.
3. دمج واجهة المندوب.

---

## 7) الملفات المتأثرة بهذه المرحلة

- `apps/finance/wallet-server.js`
- `apps/order/deliveryOrderCreateShared.js` (جديد)
- `apps/order/routes.js`
- `apps/delivery/routes.js`
- `.env.example`
- `docs/SOURCE-OF-TRUTH.md` (جديد)
- `docs/CONSOLIDATION-EXECUTION-REPORT.md` (هذا الملف)
