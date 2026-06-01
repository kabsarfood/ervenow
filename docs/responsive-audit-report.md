# تقرير Responsive Audit — منصة ERVENOW

**التاريخ:** 2026-05-31  
**النطاق:** جميع صفحات `public/` (49 صفحة HTML) + CSS مشترك  
**المقاسات المستهدفة:** 320 · 375 · 390 · 414 · 768 · 1024 · 1440 px  
**المتصفحات المستهدفة:** Chrome (Android/Desktop) · Safari (iPhone) · Edge  

---

## 1. ملخص تنفيذي

تم تنفيذ **طبقة Responsive موحّدة للمنصة بالكامل** بدلاً من إصلاح صفحات منفردة. الهدف: ثبات أفقي على iPhone، عدم قص العناصر، وتمدد تلقائي للخرائط والبطاقات والنوافذ والجداول والنماذج.

| المؤشر | قبل | بعد |
|--------|-----|-----|
| صفحات HTML مغطاة | جزئي | **49/49** |
| `viewport-fit.js` | 7 صفحات | **49 صفحة** |
| `100vw` في public | ~50+ موضع | **0** |
| طبقة CSS موحّدة | 2 ملف | **4 ملفات** (سلسلة styles.css) |

---

## 2. البنية الجديدة (مصدر واحد)

```
styles.css
  ├── responsive-site.css      — بطاقات، layout، typography
  ├── ervenow-responsive.css   — breakpoints، touch، safe-area، تابلت
  └── responsive-audit-base.css — منع scroll أفقي، خرائط، modals، جداول (جديد)

viewport-fit.js              — ارتفاع Safari/Android + منع zoom + ثبات أفقي (محسّن)
scripts/apply-responsive-audit.js — تطبيق تلقائي على كل HTML
npm run responsive:audit       — إعادة التطبيق عند إضافة صفحات
```

**مصدر الحقيقة:** `public/` ثم `npm run frontend:sync`

---

## 3. المشاكل المكتشفة ومعالجتها

### 3.1 اهتزاز يمين/يسار على iPhone (Safari)

| السبب | المعالجة |
|-------|----------|
| `touch-action: pan-x pan-y` يسمح بسحب أفقي | → `touch-action: pan-y` على html/body (≤1024px) |
| `overscroll-behavior` غير مكتمل أفقياً | → `overscroll-behavior-x: none` |
| `100vw` أعرض من الشاشة الفعلية | → استبدال بـ `100%` / `100dvw` حيث يلزم |
| scroll أفقي خفي على body | → `clampHorizontalScroll()` في viewport-fit.js |
| rubber-band أفقي | → `overflow-x: clip` على html/body |

### 3.2 تكبير/تصغير غير مرغوب (جوال)

| المعالجة |
|----------|
| viewport: `maximum-scale=1, minimum-scale=1, user-scalable=no` |
| منع pinch/gesture zoom في viewport-fit.js |
| حقول نماذج `font-size: 16px` (منع zoom iOS عند focus) |

### 3.3 `100vh` / `100vw` غير متوافقة

| الملفات | المعالجة |
|---------|----------|
| styles.css, guest-shell.css, ervenow-responsive.css | سلسلة `100vh` → `100dvh` → `calc(var(--erw-vh)*100)` |
| delivery/assets/app.css, track.css | إضافة `100dvh` |
| index.html, dashboard.html, cart-luxe.css | استبدال `100vw` |
| stores/restaurants/services/login | `min-height: 100dvh` + fallback |

### 3.4 صفحات بدون CSS مشترك

| الصفحة | المعالجة |
|--------|----------|
| wallet.html, pay.html, admin-dashboard.html | `responsive-audit-base.css` + viewport-fit.js |
| delivery/*, admin/index.html, admin-approvals | نفس الطبقة |
| باقي الصفحات | عبر `styles.css` (يشمل audit-base) |

### 3.5 خرائط · بطاقات · modals · جداول · نماذج

| العنصر | المعالجة في responsive-audit-base.css |
|--------|----------------------------------------|
| Leaflet (#pickupDropMap, driverLiveMap) | `max-width:100%`, `width:100%` على الجوال |
| modals (خريطة dashboard، سلة index) | `max-width:100%`, full-screen آمن ≤640px |
| جداول admin | `.erw-table-scroll`, overflow-x contain |
| نماذج | `min-width:0`, `max-width:100%` على inputs |
| بطاقات | `box-sizing`, `max-width:100%` على `.card`, `.layout` |

---

## 4. الصفحات المغطاة (49)

### زوار / طلبات
index · dashboard · cart · browse · stores · restaurants · services · store · track · my-orders · orders · order · login · start-now · partner-portal · pending-approval · blocked-complaints · gas-delivery · delivery-services · careers · wallet · pay · register-store

### مندوب
driver · driver-app · driver-login · driver-register · driver-wallet · driver-dashboard

### متجر / تاجر
store-dashboard · merchant-dashboard · services-provider

### إدارة
admin-dashboard · admin/* · admin-login · admin-finance · admin-debts · admin-commissions · admin-categories · admin-branding · admin-settings · admin-withdrawals · admin-approvals

### legacy delivery
delivery/index · login · map · orders

### أخرى
erwenow.html (إن وُجد)

---

## 5. Breakpoints المطبّقة

| المقاس | CSS |
|--------|-----|
| ≤320px | padding ضيق، خطوط header أصغر |
| 321–414px | clamp للعناوين |
| 415–768px | browse grid عمودين |
| 641–1024px | تابلت: header، cart، dash-hero، tabs |
| 769–1024px | layout max 960px |
| 1025–1440px | layout max 900px |
| ≥1441px | layout max 1120px |

---

## 6. اختبار موصى به

### جوال
1. **Safari iPhone** — افتح `/` و `/dashboard` → لا اهتزاز أفقي عند السحب
2. **Chrome Android (Samsung)** — «من الخريطة» → شريط سفلي ظاهر كاملاً
3. **السلة** — `/cart` → لا scroll أفقي، شريط الدفع ثابت

### تابلت (768–1024)
4. `/stores` — شبكة بطاقات متوازنة
5. `/cart` — عمودان أو sticky sidebar حسب العرض

### سطح مكتب
6. Chrome 1440px — `/dashboard` · `/admin-dashboard` — لا تمدد زائد

### Edge
7. نفس السينarios أعلاه — تحقق من `overflow-x: clip` fallback

---

## 7. أوامر الصيانة

```bash
npm run responsive:audit   # تطبيق viewport + audit على HTML جديد
npm run frontend:sync      # نسخ public → ervenow-frontend
```

---

## 8. ملاحظات

- **إمكانية الوصول:** `user-scalable=no` يمنع zoom المستخدم — مطلب تجاري صريح من المالك؛ يمكن إرجاع `maximum-scale=5` لاحقاً لـ WCAG إن رُغب.
- **admin-dashboard.html** (نسخة standalone): تستخدم `responsive-audit-base.css` دون `styles.css` لتجنب تعارض CSS inline الضخم.
- **wallet.html**: CSS inline خاص + audit-base للثبات الأفقي.

---

## 9. الملفات المعدّلة (أهم)

| ملف | دور |
|-----|-----|
| `public/assets/responsive-audit-base.css` | **جديد** — قلب الـ audit |
| `public/assets/viewport-fit.js` | ثبات Safari + clamp أفقي |
| `public/assets/ervenow-responsive.css` | touch pan-y، map full-screen |
| `public/assets/guest-shell.css` | overflow-x clip |
| `public/assets/styles.css` | import audit-base |
| `scripts/apply-responsive-audit.js` | **جديد** — أتمتة 49 صفحة |
| `public/**/*.html` | viewport + viewport-fit.js |
| `public/dashboard.html` | إزالة 100vw |
| `public/index.html` | viewport + cart heights |

---

**النتيجة المتوقعة:** المنصة تعمل بنفس الجودة على الهاتف والتابلت وسطح المكتب — بدون قص أفقي، بدون اهتزاز iPhone، وبتمدد تلقائي للمحتوى.
