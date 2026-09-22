# ERVENOW — تنفيذ إلغاء `/dashboard`

**التاريخ:** 2026-09-22  
**النوع:** تنفيذ — إلغاء واجهة العميل `/dashboard`  
**الوجهة الرسمية:** `/`  
**لم يُنشأ:** `/account`

لم يُغيَّر: Login destination · الطلبات · Wallet · Tracking · Notifications · Role Routing.

---

## القرار المنفَّذ

`/dashboard` لم تعد واجهة عميل. أي زيارة لـ `/dashboard` أو `/dashboard.html` تُحوَّل 302 إلى `/`.

---

## Redirect

`server/server.js` — قبل `express.static`:

```
app.get(["/dashboard", "/dashboard.html"], (_req, res) => {
  res.redirect(302, "/");
});
```

Vercel (`ervenow-frontend/vercel.json` + مولّد `scripts/sync-ervenow-frontend.js`):

- `redirects`: `/dashboard` و `/dashboard.html` → `/` بـ statusCode 302

الملفات المحذوفة:

- `public/dashboard.html`
- `ervenow-frontend/dashboard.html`

---

## الروابط التي أُزيلت (كانت `/dashboard` → أصبحت `/`)

هيدر guest-shell: أُزيل عنصر «منصة ERVENOW» حتى لا يتكرر مع «الرئيسية».

صفحات HTML (public + مرآة frontend): browse, cart, checkout, delivery-map, delivery-services, gas-delivery, live-map, login (هيدر فقط), my-orders (بما فيه «ابدأ طلباً جديداً»), order, restaurants, stores, store, services, service-book, start-now, track, wallet, register-store, careers, car-polishing, legal, index (إعدادات + إزالة رابط المنصة المكرر), admin chip.

JS:

- `guest-shell.js` — لا رابط `/dashboard`
- `cart-ui.js` — `continueHref` الافتراضي `/`
- `mobile-foundation.js` — لا مطابقة مسار dashboard
- `account-destinations.js` — canonical `/dashboard` → `/` (دفاع فقط، ليس Login)

---

## ما بقي عن قصد (ليس واجهة عميل)

| المرجع | السبب |
| --- | --- |
| `/api/services/me/dashboard` | API بوابة مزود الخدمة |
| `admin/modules/dashboard.js` | لوحة الإدارة |
| `store-dashboard` / `driver-dashboard` / `merchant-dashboard` | بوابات شركاء |
| `store-preview-mode.js` / `store-shell.js` قائمة حظر `/dashboard` | دفاع مسار قديم |
| سكربتات one-off (`clean-dashboard-map-modal.js` إلخ) | تتخطى الملف إن لم يوجد |

---

## البنرات

البيانات **لم تُحذف**.

- `visitor_dashboard` بقي معرّفاً في الأدمن، `page: "/"`
- `guest_dashboard` بقي placement قديماً، `page: "/"`
- `bannerHasTarget(..., "home")` يشمل بنرات `visitor_dashboard`
- لذلك `GET /api/core/banners?target=home` يعرض بنرات الرئيسية + بنرات لوحة الزائر السابقة على `/`
- مفتاح API القديم `guest_dashboard_banners` ما زال يُرجع بنرات `visitor_dashboard` دون مسح الصفوف

---

## الاختبارات

`npx jest --ci --no-coverage`

- 100 suite ناجحة (1 skipped سابق)
- 497 اختبار ناجح
- جديد: `tests/unit/dashboardRetired.test.js`
- Login/Role Routing: `resolvePortalRole.test.js` ما زال `customer → /`

---

## تأكيد لا اعتماد حي على `/dashboard` كصفحة

- لا `public/dashboard.html` ولا مرآتها
- لا `href="/dashboard"` في `public/`
- guest-shell لا يبني رابط dashboard
- أي URL قديم يمر عبر 302 إلى `/`
