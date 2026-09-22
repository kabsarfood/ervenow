# ERVENOW — تنفيذ إلغاء `/start-now`

**التاريخ:** 2026-09-22  
**النوع:** تنفيذ — إلغاء واجهة العميل `/start-now` و `/start-now.html`  
**الصفحة الرئيسية الوحيدة:** `/`  
**استكشاف داخل الرئيسية:** `/#snHomeHub`

لم يُغيَّر: Login destination · الطلبات · Wallet · Tracking · Notifications · Role Routing · Unified Orders · بوابات Merchant / Driver / Service.

---

## القرار المنفَّذ

`/start-now` و `/start-now.html` لم تعودا واجهة مستقلة. أي زيارة لهما تُحوَّل 302 إلى `/`.

`/customer-preview` و `/customer-preview.html` يذهبان مباشرة 302 إلى `/` (قفزة واحدة، بلا سلسلة إلى start-now).

---

## Redirect

`server/server.js` — قبل `express.static`:

```
app.get(["/start-now", "/start-now.html"], (_req, res) => {
  res.redirect(302, "/");
});

app.get(["/customer-preview", "/customer-preview.html"], (_req, res) => {
  res.redirect(302, "/");
});
```

Vercel (`ervenow-frontend/vercel.json` + مولّد `scripts/sync-ervenow-frontend.js`):

- `redirects`: `/start-now` و `/start-now.html` و `/customer-preview` و `/customer-preview.html` → `/` بـ statusCode 302

---

## الروابط التي حُوّلت

| المصدر | قبل | بعد |
|---|---|---|
| Bottom nav «استكشاف» | `/start-now` | `/#snHomeHub` |
| login CTA «ابدأ الآن» | `/start-now.html` | `/` |
| delivery-services «ابدأ الآن» | `/start-now.html` | `/` |
| cart-ui empty CTA | `/start-now.html` | `/` |
| guest-offers default CTA | `/start-now` | `/` |
| Admin hero-banners templates | `/start-now` | `/` |
| customer-preview (المسار) | 301 `/start-now.html` | 302 `/` |
| customer-preview.js (روابط داخلية) | `/start-now.html` | `/` أو `/#snHomeHub` |
| apply-guest-shell footer | `/start-now.html` | `/` |
| mobile-preview lab | `/start-now` | أُزيلت الصفحة من القائمة |

---

## portal-launch.json

`customer_platform_home` كان `/start-now.html` (متأخر عن الكود).

الآن: `"/"`

الكود الحي لم يتغيّر: `CUSTOMER_PLATFORM_HOME = "/"` في `portalLaunch.js` و `role-routing.js`.

---

## الملفات المحذوفة

- `public/start-now.html`
- `ervenow-frontend/start-now.html`
- `public/assets/start-now-page.css` (خاص بالصفحة المتقاعدة)
- `ervenow-frontend/assets/start-now-page.css`

**أُبقي:** `start-now-landing.css` — مستخدم في `/` و `/restaurants` و `/stores` و `/services` و login و delivery-services.

---

## السكربتات الميتة

| عنصر | النتيجة |
|---|---|
| `#offers` | لم يكن موجوداً في start-now. روابط customer-preview إليه حُوّلت إلى `/#snHomeHub` أو `/` |
| `#headerDashBtn` و `.guest-only` | كانا داخل HTML المحذوف فقط — زالا مع الصفحة |
| `data-guest-only` في `/` | حيّ ومستخدَم — لم يُمسّ |
| `customer-preview.js` / `.css` / `.html` | Legacy: المسار 302 إلى `/` فلا يُخدم. الملف أُبقي مع روابط محدّثة حتى لا يبقى href حي إلى start-now |

---

## اعتماد متبقٍ غير حيّ

- `account-destinations.js`: يحوّل `/start-now` → `/` لأي رابط قديم
- `store-preview-mode.js`: قائمة منع للمسار القديم
- `data/admin-readiness.json`: سجلات تاريخية
- `heroBannerStore` test: تطبيع `"start-now"` → `"/start-now"` (slash) وليس وجهة عميل
- Redirects في السيرفر و Vercel

لا يوجد `href="/start-now"` حي في واجهة العميل (`public/` و `ervenow-frontend/` HTML/JS).

---

## الاختبارات

Jest: `tests/unit/startNowRetired.test.js` + تحديث `checkoutEnginePhase5Cutover.test.js`.

- `/` → 200
- `/start-now` → 302 `/`
- `/start-now.html` → 302 `/`
- `/customer-preview` → 302 `/` مباشرة
- Bottom nav Explore → `/#snHomeHub` و`id="snHomeHub"` موجود في `index.html`
- لا href حي إلى `/start-now`

حي على المنفذ 4000 بعد إعادة التشغيل:

- `GET /` → 200
- `GET /start-now` → 302 `Location: /`
- `GET /start-now.html` → 302 `Location: /`
- `GET /customer-preview` → 302 `Location: /` (قفزة واحدة)
- `GET /customer-preview.html` → 302 `Location: /`

Jest كامل: 101 passed · 505 tests.
