# ERVENOW — مراجعة `/start-now` و `/start-now.html`

**النوع:** تحليل فقط — لا Redirect ولا حذف.  
**التاريخ:** 2026-09-22  
**المصدر:** `public/start-now.html` · `server/server.js` · `mobile-foundation.js` · `index.html` · `portalLaunch.js` · `bannerPlacements.js`

لا تغيير في هذه الجولة على Login أو الطلبات أو Role Routing.

---

## الخلاصة

`/start-now` و `/start-now.html` هما **نفس الملف**. الصفحة شبكة أقسام من 4 بطاقات + شريط ثقة. هذا محتوى موجود في `/` بشكل أغنى (أبواب + فروع + بنرات + سوق).

**ليست** منزل العميل بعد Login. الكود الحي: `CUSTOMER_PLATFORM_HOME = "/"`. ملف `data/portal-launch.json` الذي يقول `/start-now.html` **متأخر**.

**التصنيف: Duplicate + Legacy استكشاف.**  
**القرار: Option C — إلغاؤها لاحقاً وتحويل المسارين إلى `/`.**  
لا تنفيذ الآن.

---

## 1. الوظيفة الحالية بالضبط

مساران لنفس HTML:

```
app.get("/start-now", … sendFile("start-now.html"))
```

`/start-now.html` تُخدم عبر `express.static` (نفس الملف).

المحتوى:

- عنوان «اختر ما يناسبك»
- 4 روابط فقط: `/restaurants` · `/stores` · `/delivery-services.html` · `/services`
- شريط ثقة (توصيل سريع · دفع آمن · تتبع لحظي · دعم فوري)
- هيدر guest-shell + سلة + محفظة هيدر

لا نماذج طلب، لا قوائم متاجر، لا بنرات، لا عروض (`#offers` غير موجود رغم روابط قديمة إليه).

سكربت مضمّن يبحث عن `.guest-only` و `#headerDashBtn` — **العنصران غير موجودين في الصفحة** (كود ميت).

---

## 2. الملفات

| دور | ملف |
| --- | --- |
| الصفحة | `public/start-now.html` (مرآة `ervenow-frontend/start-now.html`) |
| التوجيه | `server/server.js` — `GET /start-now` |
| CSS خاص | `start-now-page.css` + CSS مضمّن |
| CSS مشترك | `start-now-landing.css` — **مستخدم أيضاً في `/` و `/restaurants` و `/stores` و `/services` و login** — لا يُحذف مع الصفحة |
| JS | `guest-shell.js` · `guestBrowse.js` · `order-draft-*` · `api.js` · `ervenow-toggle.js` |

لا `start-now.js` تشغيلي.

---

## 3. الـ APIs

الصفحة **لا تستدعي API خاصاً بها**.

إن وُجد توكن، `guest-shell.js` يستدعي كأي صفحة ضيف:

- `GET /api/core/me`
- محفظة الهيدر (`/api/wallet` أو مسار الدور)

لا `platform-offers`، لا بنرات `target=start-now`، لا طلبات.

---

## 4. ما فيها وغير موجود في `/`؟

لا شيء تشغيلي.

| عنصر | `/start-now` | `/` |
| --- | --- | --- |
| مطاعم / متاجر / توصيل / خدمات | 4 بطاقات بلا فروع | أبواب + روابط فرعية (كافيه، سوبرماركت، غاز…) |
| شريط ثقة | نعم — نفس النصوص تقريباً | نعم `#trust` |
| بنرات / عروض | لا | نعم (`home_promo` / `home_hero` + كاروسيل) |
| قوائم سوق حية | لا | نعم |
| كيف تعمل / تواصل / سجّل متجرك | لا | نعم |
| عنوان SEO | «استكشاف \| ERVENOW» | «المنصة الذكية» |

`/` أغنى في كل اتجاه. `/start-now` مجموعة فرعية من أبواب الرئيسية.

---

## 5. هل فيها وظيفة تشغيلية حقيقية؟

**لا.** روابط تصفّح فقط. الطلب يتم في صفحات الأقسام ثم checkout.

---

## 6. Login / Navigation / CTA / Bottom Nav

| المصدر | يعتمد عليها؟ | التفصيل |
| --- | --- | --- |
| Login بعد النجاح | **لا** | `resolvePostLoginPath(customer) === "/"` |
| `account-destinations.js` | دفاع فقط | يحوّل مسار `/start-now` إلى `/` إن وُجد كوجهة قديمة |
| `data/portal-launch.json` | بيانات متأخرة | ما زال يكتب `customer_platform_home: "/start-now.html"` — **الكود لا يقرأه لهذا الغرض** |
| Bottom nav | **نعم — أقوى اعتماد حي** | تبويب «استكشاف» → `/start-now` |
| guest-shell (بعد الرسم) | لا رابط start-now | الصفحة نفسها تضع «استكشاف» في HTML الثابت قبل JS |
| Login هيدر | CTA | زر «ابدأ الآن» → `/start-now.html` (ليس وجهة OTP) |
| سلة فارغة `cart-ui.js` | افتراضي | «ابدأ طلباً» → `/start-now.html` (`cart.html` يستخدم checkoutV3 فيتجاوزه غالباً) |

---

## 7. روابط حية تشير إليها؟

متوسطة — أقل من `/dashboard` السابق، لكن **حقيقة**:

- شريط الجوال «استكشاف»
- `login.html` زر ابدأ الآن
- `delivery-services.html` «ابدأ الآن»
- افتراضي رابط البنر إن لم يُضبط URL: `guest-offers-carousel.js` → `/start-now`
- قوالب أدمن بنرات `button1_url: "/start-now"`
- `GET /customer-preview` → **301 `/start-now.html`**
- `customer-preview.js` (ميت للمسار؛ الصفحة محوّلة) يشير إلى `/start-now.html#offers` و **لا يوجد `#offers` في start-now.html**
- `store-preview-mode.js` يحظر المسار (دفاع معاينة تاجر)
- لقطات/سكربتات تدقيق

`index.html` **لا** يحتوي `href="/start-now"` اليوم.

---

## 8. بنرات / placements؟

**لا placement باسم start-now.**  
`bannerPlacements.js` و `bannerTargets.js` لا يعرّفان صفحة `/start-now`.

الاستخدام الوحيد: **رابط زر افتراضي** في بنرات الرئيسية (`/start-now`) إن لم يُملأ `button1_url`. هذا CTA وليس بنر معروضاً على صفحة الاستكشاف.

---

## 9. قيمة SEO مستقلة؟

ضعيفة جداً.

- `title`: استكشاف | ERVENOW
- `description`: جملة عامة عن الأقسام الأربعة
- لا `canonical`، لا sitemap في المستودع
- محتوى مكرر أضعف من `/`
- الإبقاء كـ URL مستقل يشتت «المنزل» بعد إلغاء `/dashboard`

---

## 10. هل الحذف يؤثر؟

| المجال | يكسر؟ |
| --- | --- |
| الطلبات | لا |
| الأقسام / المتاجر / الخدمات | لا — الصفحات مستقلة |
| السلة | لا — دورة checkout مستقلة؛ زر السلة الفارغة يحتاج تحديث رابط فقط |
| الجلسة | لا |
| التوجيه بعد Login | لا — أصلاً `/` |
| Navigation | **نعم بلا Redirect**: تبويب استكشاف + أزرار ابدأ الآن + 301 من customer-preview + افتراضي البنر |

`start-now-landing.css` **لا يُحذف** مع الصفحة.

---

## مقارنة مباشرة مع `/`

`/` = Customer Home (تسويق + أبواب + سوق + بنرات).  
`/start-now` = اختصار «الأقسام الأربعة» بنفس الوجهات.

بعد إلغاء `/dashboard`، الإبقاء على `/start-now` يُعيد منزلين للتصفّح.

---

## التصنيف

| النوع | الحكم |
| --- | --- |
| صفحة مهمة | لا |
| صفحة استكشاف مستقلة | شكلاً فقط (تبويب باسم استكشاف) — المحتوى ليس مستقلاً |
| Legacy | نعم — بقايا customer-preview و portal-launch.json |
| Duplicate | **نعم — الوصف الأدق** |

---

## القرار: Option C

**A مرفوض** — منزل تصفّح ثانٍ.  
**B غير لازم كعمل محتوى** — أبواب `/` تغطي الوظيفة مسبقاً.  
**C مختار:** `/start-now` و `/start-now.html` → Redirect 302 إلى `/`.

### قبل الإلغاء (لاحقاً — لا الآن)

1. تبويب الجوال «استكشاف»: الأفضل `/#snHomeHub` أو `/#home-cats-title` حتى لا يصير تبويبان لنفس URL دون قفز. إن بقي `/start-now` كـ Redirect فقط، التبويب يعمل لكن يطابق «الرئيسية» بعد التحويل.
2. `login.html` زر ابدأ الآن → `/`
3. `delivery-services.html` → `/`
4. `cart-ui.js` ابدأ طلباً → `/`
5. افتراضي `guest-offers-carousel` و قوالب أدمن `button1_url` → `/`
6. `customer-preview` 301 → `/` بدل `/start-now.html`
7. تحديث `data/portal-launch.json` (حقل متأخر)
8. اختبار `heroBannerStore` الذي يتوقع تطبيع `start-now` → `/start-now` (رابط زر، ليس الصفحة)
9. الإبقاء على `start-now-landing.css`

حتى الموافقة: لا Redirect ولا حذف.
