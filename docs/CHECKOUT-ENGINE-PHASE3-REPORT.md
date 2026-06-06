# Checkout Engine V1 — Phase 3 Report: Vertical → Order Draft

**التاريخ:** 2026-06-06  
**الحالة:** مكتمل — ربط Verticals (بدون حذف Legacy)  
**النطاق:** كل مسار إضافة طلب B2C يكتب `ErvenowOrderDraft` ثم `/checkout`

---

## 1. ما تم بناؤه

| الملف | الدور |
|-------|------|
| `shared/orderDraft/verticalDraftBridge.js` | دمج البنود، `commitItemToDraft`, توافق Pre-Cart |
| `public/assets/order-draft-vertical.js` | API المتصفح: `ErvenowOrderDraftVertical.commit()` |
| `public/assets/order-draft-vertical.logic.js` | نقطة دخول الاختبارات |
| `tests/unit/verticalDraftBridge.test.js` | 4 اختبارات |
| `tests/unit/checkoutEnginePhase3.test.js` | حراس ربط Verticals |

### API المتصفح — `ErvenowOrderDraftVertical`

| الدالة | الوصف |
|--------|--------|
| `commit(item, opts)` | دمج → `writeDraft()` → `redirect: /checkout` (افتراضي) |
| `getItems()` | قراءة بنود المسودة |
| `assertSnapshotCompatible(items, snap)` | قواعد متجر واحد / توصيل موحّد |
| `saveCustomerLocation(loc)` | حفظ موقع في المسودة (Pre-Cart) |
| `syncHeaderBadge()` | تحديث `#cartCount` من المسودة |
| `validateSaPhone(phone)` | تحقق جوال SA |

---

## 2. Verticals — ما أصبح يدخل عبر Draft ✅

| الأولوية | Vertical | نقطة الدخول | `meta.vertical` | بعد الإضافة |
|----------|----------|-------------|-----------------|-------------|
| **P0** | Store | `store.html` → `addProductToCartWithSnapshot` | `store` | `/checkout` |
| **P0** | Restaurant | نفس `store.html` (`store_type=restaurant`) | `restaurant` | `/checkout` |
| **P1** | Services | `services.html` نموذج الخدمات | `service` | `/checkout` |
| **P1** | Gas | `gas-delivery.html` → `goCart()` | `gas` | `/checkout` |
| **P2** | Vehicle | `delivery-services.html` → `addCarToCart` | `vehicle` | `/checkout` |
| **P2** | Vehicle (متعدد) | `browse.html` أنواع نقل/غاز | `vehicle` / `gas` / `service` | `/checkout` |
| **P2** | Map Delivery | `delivery-map-page.js` → `createOrder()` | `map_delivery` | `/checkout` |
| — | Order (عام) | `order.html` → `btnCart` | `service` | `/checkout` |

### دعم مساعد

| المكوّن | التغيير |
|---------|---------|
| `pre-cart-delivery.js` | يقرأ/يتحقق من **مسودة** بدل `getCart()`؛ يحفظ الموقع في المسودة |
| `checkout-engine.js` | يستعيد `ervenow:pending-map-draft` بعد تسجيل الدخول |
| `checkout.html` | يحمّل `order-draft-vertical.js` |

**قواعد Phase 3 محققة على المسارات أعلاه:**

- ✅ `ErvenowOrderDraft.writeDraft()` فقط (عبر `commit`)
- ✅ لا كتابة على `localStorage["cart"]`
- ✅ لا `ErvenowCart.add()` / `ErvenowServiceCart.add()`
- ✅ لا حذف Legacy

---

## 3. ما زال يستخدم Cart القديمة ⚠️

### صفحات / مسارات إنتاج Legacy (لم تُحذف عمداً)

| المسار | الاستخدام |
|--------|-----------|
| `/cart` + `cart.html` | Checkout Legacy كامل (`cart.js`, `cart-ui.js`, `executeCartCheckout`) |
| `cart.js` | مصدر السلة `localStorage["cart"]`، `addToCart`, `ErvenowCart` |
| `cart-ui.js` | قالب lpCart |
| `service-cart.js` | `ErvenowServiceCart.add` → `ErvenowCart` (ما زال موجوداً لـ Legacy) |
| `index.html` | **Mini Cart / lpCart** — `cart.js` + توجيه `/cart` |
| `dashboard.html` | يحمّل `cart.js` + `service-cart.js` (لوحة زائر — لم يُربط بإضافة draft) |
| `cart.html` | `restorePendingMapCart` → `addToCart` (Legacy؛ استُبدل بـ `pending-map-draft` في الخريطة) |

### روابط UI ما زالت تشير لـ `/cart` (عرض فقط — لم يُحذف)

هيدر «السلة» في: `store.html`, `services.html`, `gas-delivery.html`, `delivery-services.html`, `delivery-map.html`, `order.html`, `browse.html`, `index.html`, `dashboard.html`, وغيرها — **الرابط `/cart` لم يُستبدل** في Phase 3 (ربط إضافة فقط).

### `browse.html` — جزئي

| البند | الحالة |
|-------|--------|
| إضافة طلب (`ErvenowCart.add`) | ✅ Draft عبر `commit` |
| `clearCart()` / `goCheckout()` / `ErvenowCart.render()` | ⚠️ Legacy (أزرار قديمة في الصفحة) |

### عداد الهيدر `#cartCount`

| الصفحة | المصدر |
|--------|--------|
| Verticals المربوطة | `syncHeaderBadge()` من المسودة (بعد الإضافة) |
| `index.html`, صفحات تحمّل `cart.js` | `updateCartCount()` من `cart` Legacy |

### Backend / API

| البند | الحالة |
|-------|--------|
| `POST /api/order/create` | موحّد — يُستدعى من `/checkout` ومن `/cart` Legacy |
| `tryMigrateFromLegacyCart` في `/checkout` | يقرأ `cart` القديمة للترحيل فقط (غير تدميري) |

---

## 4. الملفات الملموسة (Phase 3)

**جديدة:** `verticalDraftBridge.js`, `order-draft-vertical.js`, `.logic.js`, اختبارات، هذا التقرير.

**محدّثة:**

- `store.html`
- `pre-cart-delivery.js`
- `services.html`
- `gas-delivery.html`
- `delivery-services.html`
- `delivery-map.html`
- `delivery-map-page.js`
- `order.html`
- `browse.html`
- `checkout.html`
- `checkout-engine.js`

**لم يُمس (Legacy):** `cart.js`, `cart-ui.js`, `service-cart.js`, `cart.html`, `index.html` (lpCart).

---

## 5. نتائج الاختبارات

```
46 suites, 190 tests — ALL PASSED
```

يشمل:

- `verticalDraftBridge.test.js`
- `checkoutEnginePhase3.test.js` (لا `ErvenowCart.add` في صفحات Verticals)
- Phase 1 + Phase 2 guards

---

## 6. تدفق موحّد بعد Phase 3

```text
أي Vertical (جدول §2)
  → ErvenowOrderDraftVertical.commit(item)
  → ErvenowOrderDraft.writeDraft()
  → redirect /checkout
  → POST /api/order/create
  → clearDraft()
```

```text
Legacy (ما زال متاحاً)
  → ErvenowCart.add / ServiceCart
  → localStorage["cart"]
  → /cart → POST /api/order/create → clearCart()
```

---

## 7. الخطوة التالية المقترحة (بعد اعتماد Phase 3)

1. تحويل روابط الهيدر `/cart` → `/checkout` على الصفحات المربوطة
2. ربط `index.html` lpCart بـ Draft أو إيقاف Mini Cart
3. إزالة `browse.html` أزرار Legacy (`clearCart`, `goCheckout`)
4. Phase حذف Legacy (`cart.js`, `cart-ui.js`, …) — **فقط بعد اعتماد منفصل**
