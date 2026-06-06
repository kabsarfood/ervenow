# Checkout Engine V1 — Phase 4: Legacy Shutdown Audit

**التاريخ:** 2026-06-06  
**النوع:** تقرير فحص فقط — **لا حذف، لا refactor، لا تعديل**  
**المصدر:** `public/` (canonical) + مرآة `ervenow-frontend/` + `server/` + `tests/` + `scripts/`

---

## 1. Legacy Usage Scan

### 1.1 صفحات تحمّل `cart.js` (وسم `<script>` صريح)

| الصفحة | الدور الحالي |
|--------|----------------|
| `public/cart.html` | Checkout Legacy كامل + `executeCartCheckout` |
| `public/index.html` | **Mini Cart (lpCart)** + `updateCartCount` + `handleLpCartCheckoutClick` |
| `public/dashboard.html` | عداد هيدر `#cartCount` فقط |
| `public/track.html` | عداد هيدر فقط |
| `public/my-orders.html` | عداد هيدر + فوتر «السلة» |
| `public/restaurants.html` | عداد هيدر (قائمة مطاعم — لا إضافة منتج هنا) |
| `public/stores.html` | عداد هيدر (قائمة متاجر) |
| `public/start-now.html` | عداد هيدر |
| `public/careers.html` | عداد هيدر |
| `public/blocked-complaints.html` | عداد هيدر |

**لا تحمّل `cart.js` (بعد Phase 3 — Verticals على Draft):**

`store.html`, `services.html`, `gas-delivery.html`, `delivery-services.html`, `delivery-map.html`, `order.html`, `browse.html`, `checkout.html`

### 1.2 صفحات تحمّل `cart-ui.js`

| النوع | الصفحات / المسارات |
|-------|---------------------|
| **تحميل صريح** | `public/cart.html` فقط |
| **تحميل ديناميكي** | `public/assets/guest-shell.js` → `loadCartUi()` يحقن `cart-ui.js` على كل صفحة `guest-shell-page` عند `init()` |

**تأثير ديناميكي:** أي صفحة تستخدم `ErvenowGuestShell.init()` وتحتوي `body.guest-shell-page` قد تحمّل `cart-ui.js` تلقائياً (ما لم يكن `lpCartWrap` موجوداً مسبقاً كما في `index.html`).

### 1.3 صفحات تحمّل `service-cart.js`

| الصفحة | ملاحظة |
|--------|--------|
| `public/cart.html` | `ErvenowServiceCart` + استعادة `pending-map-cart` |
| `public/dashboard.html` | يُحمَّل لكن **لا يوجد** `ErvenowServiceCart.add` في inline scripts |

### 1.4 استخدام `ErvenowCart` / `ErvenowCartUI` / `ErvenowServiceCart`

| الرمز | أين يُعرَّف | أين يُستدعى في Runtime (B2C) |
|-------|------------|------------------------------|
| `ErvenowCart` | `cart.js` | `cart.html` (checkout)، `index.html` (lpCart)، `browse.html` (**بدون cart.js** — مراجع ميتة: `clear`/`goCheckout`/`render`) |
| `ErvenowCartUI` | `cart-ui.js` | `cart.html`، `guest-shell.js` (mini drawer)، `index.html` (معاينة هيدر) |
| `ErvenowServiceCart` | `service-cart.js` | `cart.html` فقط (في `public/` بعد Phase 3) |

**ملفات داعمة (ليست صفحات):**

| الملف | الاستخدام |
|-------|-----------|
| `public/assets/platform-access.js` | يلفّ `ErvenowCart.add` لمنع السائق من الطلب |
| `public/assets/kabsar-store-polish.js` | `getCart()` لعرض `#storeCartLink` — **store.html لا يحمّل cart.js** (يعتمد fallback `[]`) |
| `public/assets/cart-ui.js` | `ErvenowCart.goCheckout()` |
| `public/assets/service-cart.js` | يوجّه إلى `/cart` بعد الإضافة |

### 1.5 `localStorage["cart"]`

| الموقع | القراءة | الكتابة |
|--------|---------|---------|
| `public/assets/cart.js` | ✅ `readCartStore` / `getCart` | ✅ `saveCart` / `addToCart` / `clear` |
| `shared/orderDraft/*` + `order-draft-store.js` | ✅ `tryMigrateFromLegacyCart` فقط | ❌ لا كتابة |
| `tests/e2e/smoke.spec.js` | ✅ | ✅ (اختبارات) |
| `scripts/test-map-modal-functional.js` | ✅ | — |

**لا توجد صفحة Vertical (Phase 3) تكتب `localStorage["cart"]` مباشرة.**

---

## 2. Runtime Dependency Audit

> سيناريو افتراضي: حذف `cart.html`, `cart.js`, `cart-ui.js`, `service-cart.js` **دون** بدائل.

### 2.1 حذف `cart.html`

| ما يتوقف / ينكسر |
|------------------|
| `GET /cart` (في `server/server.js`) → 404 ما لم يُضف redirect |
| مسار Checkout Legacy بالكامل (`executeCartCheckout`, V3 UI, `storeDeliveryCard`) |
| استعادة `ervenow:pending-map-cart` في `cart.html` (المسار الجديد: `pending-map-draft` → `/checkout`) |
| روابط الهيدر/الفوتر كلها `href="/cart"` |
| `service-cart.js` redirect الافتراضي → `/cart` |
| `ErvenowCart.goCheckout()` عندما `path !== "/cart"` يوجّه `location.href = "/cart"` |
| `cart.js` login `next=/cart` لمسار checkout legacy |

### 2.2 حذف `cart.js`

| ما يتوقف / ينكسر |
|------------------|
| **Mini Cart في `index.html`**: عرض البنود، `updateCartCount`, `renderHeaderCartPreview`, زر «إتمام الطلب» |
| عداد `#cartCount` في: `index`, `dashboard`, `track`, `my-orders`, `restaurants`, `stores`, `start-now`, `careers`, `blocked-complaints` |
| `window.addToCart`, `getCart`, `saveCart`, `executeCartCheckout`, `buildFinancialIntent` (كلها global من cart.js) |
| `platform-access.js` — لفّ `ErvenowCart.add` |
| `service-cart.js` — يعتمد `ErvenowCart.add` |
| `kabsar-store-polish.js` — `getCart()` (المجموع في `store.html` يبقى 0 دائماً عملياً) |
| `browse.html` — `ErvenowCart.clear/goCheckout/render` (غير فعّال أصلاً بدون cart.js) |
| `guest-shell` + `cart-ui` — أزرار checkout تعتمد `ErvenowCart.goCheckout` |
| **لا يتأثر:** Verticals Phase 3 (Draft → `/checkout`)، `checkout-engine.js` |

### 2.3 حذف `cart-ui.js`

| ما يتوقف / ينكسر |
|------------------|
| `cart.html` — `ErvenowCartUI.cartPanelInnerHtml` |
| `guest-shell.js` — `loadCartUi`, `mountGuestHeaderCart` (درج السلة في الهيدر) |
| `index.html` — هيكل lpCart يفقد ربط UI الديناميكي لبعض الأزرار/الأكورديون |
| زر checkout داخل lpCart عبر `cart-ui.js` → `goCheckout` |

### 2.4 حذف `service-cart.js`

| ما يتوقف / ينكسر |
|------------------|
| `cart.html` — `validateSaPhone` لـ `pending-map-cart` |
| `dashboard.html` — تحميل ملف بلا استخدام فعلي |
| `cart.js` — `ErvenowCart.addService` |
| `tests/e2e/smoke.spec.js` — 3 اختبارات «service carts» (`ErvenowServiceCart.add`) |
| **لا يتأثر:** Verticals Phase 3 (تستخدم `ErvenowOrderDraftVertical`) |

### 2.5 ملخص: ما يبقى يعمل بعد الحذف الأربعة (بدون إصلاح)

| يعمل | لا يعمل |
|------|---------|
| `/checkout` + `checkout-engine.js` | `/cart` |
| `ErvenowOrderDraft` + Vertical `commit()` | Mini Cart `index.html` |
| `POST /api/order/create` من checkout | عداد السلة Legacy في معظم الصفحات |
| Pre-Cart → Draft (store) | `kabsar-store-polish` مجموع السلة |
| Map delivery → Draft | e2e service-cart / cart v2 smoke |

---

## 3. Header Audit — السلة / Checkout / إتمام الطلب

### 3.1 روابط ثابتة `href="/cart"` (في `public/*.html`)

| الصفحة | عناصر |
|--------|--------|
| `store.html` | `dash-header-cart` + `store-cart-link` |
| `services.html` | `dash-header-cart` + `#svcCartLink` (مخفي) |
| `gas-delivery.html` | `dash-header-cart` |
| `delivery-services.html` | `dash-header-cart` + زر JS «عرض السلة» |
| `delivery-map.html` | `dash-header-cart` |
| `order.html` | `dash-header-cart` |
| `browse.html` | `dash-header-cart` |
| `cart.html` | `dash-header-cart` |
| `dashboard.html` | `dash-header-cart` |
| `track.html` | `dash-header-cart` |
| `my-orders.html` | هيدر + فوتر |
| `restaurants.html` | `dash-header-cart` |
| `stores.html` | `dash-header-cart` |
| `start-now.html` | `dash-header-cart` |
| `careers.html` | `dash-header-cart` |

**المجموع:** 15 صفحة HTML، ~17 رابطاً ثابتاً إلى `/cart`.

### 3.2 مصدر هيدر ديناميكي

`public/assets/guest-shell.js` يبني:

```html
<a class="dash-header-cart" href="/cart" aria-label="السلة — الدفع">
```

→ أي صفحة تعتمد `guest-shell` للهيدر ترث `/cart` ما لم تُستبدل يدوياً في HTML.

### 3.3 توجيه إلى `/checkout`

| النوع | الموقع |
|-------|--------|
| **لا يوجد** `href="/checkout"` في HTML عام | — |
| **JS redirect بعد Draft** | `order-draft-vertical.js` → `CHECKOUT_PATH` |
| | `delivery-services.html` بعد إضافة مركبة |
| **Login next** | `checkout-engine.js`, `delivery-map-page.js` (ضيف) → `next=/checkout` |
| **مسار خادم** | `server/server.js` → `GET /checkout` → `checkout.html` |

### 3.4 أزرار «إتمام / تأكيد الطلب»

| الزر | الصفحة | الوجهة / السلوك |
|------|--------|-----------------|
| `#lpCartCheckoutBtn` «إتمام الطلب» | `index.html` | `handleLpCartCheckoutClick` → `/cart` أو checkout على `/cart` |
| `#lpCartCheckoutBtn` / `#cartMobileCheckoutBtn` | `cart.html` | `executeCartCheckout` → `POST /api/order/create` |
| `#checkoutConfirmBtn` «تأكيد الطلب» | `checkout.html` | `checkout-engine.confirmOrder` → `POST /api/order/create` |
| `goCheckout()` «السداد» | `browse.html` | `ErvenowCart.goCheckout` → `/cart` (**legacy مكسور**) |

---

## 4. Final Legacy Inventory

| الملف | يُستخدم؟ | يمكن حذفه؟ | ملاحظة |
|-------|----------|------------|--------|
| `public/cart.html` | ✅ Checkout Legacy | ❌ بعد Cutover | يحتاج redirect `/cart` → `/checkout` أولاً |
| `public/assets/cart.js` | ✅ index + 9 صفحات + cart.html | ❌ بعد Cutover | نواة Mini Cart + `localStorage["cart"]` |
| `public/assets/cart-ui.js` | ✅ cart.html + guest-shell ديناميكي | ❌ بعد Cutover | lpCart / drawer |
| `public/assets/service-cart.js` | ⚠️ cart.html + dashboard (تحميل فقط) | ⚠️ جزئياً | e2e ما زال يعتمد عليه |
| `public/assets/cart-luxe.css` | ✅ index, cart, guest-shell | ❌ مع cart-ui | |
| `public/assets/cart-shell.css` | ✅ index, cart, guest-shell | ❌ مع cart-ui | |
| `public/assets/cart-page.css` | ✅ cart.html فقط | ✅ بعد حذف cart.html | |
| `public/assets/cart-checkout-v3.css` | ✅ cart.html فقط | ✅ بعد حذف cart.html | |
| `public/assets/pre-cart-delivery.js` | ✅ store (Draft) | ❌ | **ليس Legacy cart** — يخدم Pre-Cart |
| `public/assets/kabsar-store-polish.js` | ✅ store | ❌ | يحتاج ربط `ErvenowOrderDraft` بدل `getCart` |
| `public/assets/platform-access.js` | ✅ لف ErvenowCart | ⚠️ | يحتاج تحديث guard |
| `public/assets/guest-shell.js` | ✅ كل guest-shell | ❌ | يحتاج إزالة `loadCartUi` + `/cart` |
| `public/index.html` (قسم lpCart) | ✅ Mini Cart | ❌ | أكبر blocker للحذف |
| `ervenow-frontend/*` | ✅ مرآة قديمة | — | **غير متزامنة** مع `public/` بعد Phase 3 |
| `tests/e2e/smoke.spec.js` (service carts) | ✅ | — | يفترض `localStorage["cart"]` |
| `scripts/apply-guest-shell.mjs` | ✅ | — | يحقن `cart.js` في قوالب |

**آمن للإبقاء (محرك جديد):**

`checkout.html`, `checkout-engine.js`, `checkout-payment-engine.js`, `checkout-page.css`, `order-draft-store.js`, `order-draft-vertical.js`, `shared/orderDraft/*`, `shared/checkout/*`

---

## 5. Cutover Plan — `/checkout` المسار الوحيد

### الخطوة 1 — توجيه وروابط (بدون حذف ملفات)

1. `server/server.js`: `GET /cart` → **302 إلى `/checkout`** (مع `tryMigrateFromLegacyCart` على checkout).
2. استبدال كل `href="/cart"` و`guest-shell.js` cart link → **`/checkout`**.
3. `store.html`: `#storeCartLink` → `/checkout`؛ تحديث `kabsar-store-polish.js` لقراءة Draft.
4. `service-cart.js` redirect (إن بقي مؤقتاً) → `/checkout`.
5. `cart.js` `goCheckout` / login `next` → `/checkout`.
6. تشغيل `npm run frontend:sync` لمزامنة `ervenow-frontend`.

**معيار قبول:** لا يوجد رابط B2C عام يصل المستخدم إلى `/cart` في المتصفح.

### الخطوة 2 — إيقاف Mini Cart وعداد Legacy

1. **`index.html`**: إزالة أو تعطيل `#lpCartWrap`؛ استبدال بزر «تأكيد الطلب» → `/checkout` أو شارة Draft.
2. **`guest-shell.js`**: إزالة `loadCartUi` / `ensureCartStyles`؛ `#cartCount` من `ErvenowOrderDraftVertical.syncHeaderBadge`.
3. الصفحات التي تحمّل `cart.js` للعداد فقط: استبدال بـ `order-draft-store.js` + `syncHeaderBadge` أو إزالة العداد.
4. **`browse.html`**: حذف `clearCart` / `goCheckout` / `ErvenowCart.render`؛ زر «السداد» → `/checkout`.
5. تحديث **`tests/e2e/smoke.spec.js`**: Draft + `/checkout` بدل `localStorage["cart"]`.

**معيار قبول:** لا تحميل `cart.js` في أي صفحة B2C؛ لا `ErvenowCart` في runtime.

### الخطوة 3 — حذف Legacy (بعد اعتماد الخطوتين)

1. حذف: `cart.html`, `cart.js`, `cart-ui.js`, `service-cart.js`.
2. حذف CSS الخاصة بـ cart-page/v3 (إن لم تُستخدم).
3. إزالة `GET /cart` أو الإبقاء على redirect دائم.
4. تنظيف: `platform-access.js`, `scripts/apply-guest-shell.mjs`, `extract-delivery-map.js`.
5. اختبار: `npm run test:ci` + `npm run test:e2e` + مسار يدوي لكل Vertical → Draft → `/checkout` → طلب.

**معيار قبول:** `/checkout` هو مسار الدفع الوحيد؛ `localStorage["cart"]` لا يُكتب في الإنتاج (migration read-only اختياري لفترة محدودة).

---

## ملحق: فجوة المرآة `ervenow-frontend/`

`ervenow-frontend/` ما زال يحمّل `cart.js` + `service-cart.js` في Verticals التي حُوِّلت في `public/`:

- `store.html`, `services.html`, `gas-delivery.html`, `delivery-services.html`, `delivery-map.html`, `order.html`, `browse.html`

**قبل Cutover:** تشغيل `npm run frontend:sync` إلزامي وإلا ستبقى نسخة نشر قديمة.

---

## ملخص تنفيذي

| المحور | الحالة |
|--------|--------|
| Verticals B2C (إضافة) | ✅ Draft → `/checkout` |
| Checkout رسمي | ✅ `/checkout` |
| Mini Cart (`index.html`) | ❌ Legacy — **أكبر blocker** |
| روابط الهيدر | ❌ كلها `/cart` تقريباً |
| `cart.html` + `cart.js` | ❌ ما زالت حية للـ Mini Cart والعداد |
| `ervenow-frontend` | ⚠️ غير متزامنة |

**الحذف الآمن غير ممكن اليوم** دون الخطوات 1–2 أعلاه.
