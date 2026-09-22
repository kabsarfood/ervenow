# ERVENOW — مراجعة `/dashboard` (تحليل فقط)

**النوع:** تحليل من الكود الفعلي — لا Redirect ولا حذف ولا تعديل.  
**التاريخ:** 2026-09-22  
**المصدر:** `public/dashboard.html` · `server/server.js` · `guest-shell.js` · `mobile-foundation.js` · `role-routing.js` · `loginDestinations.js`

لا تغيير في هذه الجولة على الطلبات أو Login أو Role Routing.

---

## الخلاصة

`/dashboard` ليست لوحة تشغيلية وليست مركز حساب. هي **منزل تصفّح ثالث** (Guest Hub / Legacy Duplicate) بجانب `/` و`/start-now`.

الازدواجية مع `/` مثبتة من الكود: أبواب الطلب في الرئيسية، والتبويبات في `/dashboard`، كلها تذهب إلى نفس صفحات الأقسام.

**القرار الهندسي: Option C — إلغاء الصفحة كمنزل حي، وتحويل `/dashboard` لاحقاً إلى Redirect 302 نحو `/`.**

لا تنفيذ الآن.

---

## 1. ما وظيفة `/dashboard` الحالية بالضبط؟

مسار Express ثابت يقدّم ملف HTML:

```
app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(publicPath, "dashboard.html"));
});
```

الصفحة تعمل كـ **لوحة زائر / عضو للتصفّح**:

- هيدر guest-shell بعنوان «منصة ERVENOW»
- هيرو ترحيب ضيف أو عضو
- بطاقة ملف صغيرة بعد الجلسة (شارة الدور + رقم الجوال فقط)
- كاروسيل عروض `#guestOffersCarousel`
- تبويبات روابط: مطاعم · متاجر · خدمات · عروض · توصيل
- لا إنشاء طلب، لا قائمة طلبات، لا محفظة داخل الصفحة، لا إشعارات كصفحة، لا تتبع

حراسة الجلسة **اختيارية**: إن وُجد توكن يُستدعى `ErvenowAuthGuard.ensureApprovedAccount()`. الضيف يفتح الصفحة بدون دخول.

إن كان الدور `driver` يُحوَّل إلى `/driver`. الأدمن يرى تنبيهاً مع رابط `/admin`.

---

## 2. ما الملفات التي تشغّلها؟

| دور | ملف |
| --- | --- |
| الصفحة | `public/dashboard.html` (نسخة مرآة: `ervenow-frontend/dashboard.html`) |
| التوجيه | `server/server.js` — `GET /dashboard` → `dashboard.html` |
| CSS | `styles.css` · `guest-shell.css` · `start-now-landing.css` · `guest-offers-carousel.css` · `order-draft-badge.css` · `erv-interactive-surfaces.css` + CSS مضمّن (بقايا نموذج توصيل ميت) |
| JS | `viewport-fit.js` · `pre-reg-banner.js` · `order-draft-store.js` · `order-draft-badge.js` · `api-config.js` · `api.js` · `auth-account-guard.js` · `guestBrowse.js` · `guest-offers-carousel.js` · `membership-identity.js` · `guest-shell.js` · `ervenow-toggle.js` + سكربت مضمّن (`run()`) |

لا مكوّن React. لا ملف `dashboard.js` خاص بالعميل (ملف `admin/modules/dashboard.js` يخص لوحة الإدارة فقط).

---

## 3. ما الـ APIs التي تستخدمها؟

من السكربت المضمّن + الكاروسيل + الحراسة:

| API | متى | الغرض |
| --- | --- | --- |
| `GET /api/core/me` | إن وُجد توكن | الدور + الجوال + حراسة الاعتماد |
| `GET /api/wallet` | عميل/افتراضي | رصيد هيدر (يكرّره `guest-shell.js`) |
| `GET /api/driver/wallet` | مندوب قبل التحويل | رصيد هيدر |
| `GET /api/store/merchant-dashboard` | تاجر | رصيد هيدر |
| `GET /api/core/platform-offers` | دائماً | كاروسيل العروض + تبويب العروض |

**لا يوجد** `GET /api/.../dashboard` لهذه الصفحة.

`GET /api/services/me/dashboard` يخص بوابة مزود الخدمة (`service-preview.js`) — ليست هذه الصفحة.

---

## 4. ما الأزرار أو الوظائف الموجودة فيها؟

**هيدر:** الرئيسية `/` · منصة ERVENOW (الصفحة نفسها) · تتبع `/track` · دخول · محفظة `/wallet.html` · سلة `/checkout`

**هيرو (ضيف فقط):** ابدأ الآن `/start-now` · دخول الأعضاء · إنشاء عضوية

**بعد الدخول:** إخفاء أزرار الهيرو + إظهار بطاقة الملف

**تبويبات (روابط فقط، لا منطق طلب):**

- مطاعم → `/restaurants` و`?category=...` (كبسة، شاورما، سمك، برقر، بروستد، بيتزا، مقاهي، حلويات، أسر منتجة)
- متاجر → `/stores?type=...`
- خدمات → `/services?type=...` و`/car-polishing.html`
- عروض → `/browse` + شبكة من `platform-offers`
- توصيل → `/delivery-services.html` · `/gas-delivery.html` · `/delivery-map`
- زر فارغ: الخريطة الحية `/live-map`

لا أزرار: إلغاء طلب، دفع، شحن محفظة، إعدادات حساب، خروج داخل الصفحة (الخروج يأتي من guest-shell بعد الدخول).

---

## 5. هل فيها وظيفة غير موجودة في `/` · `/my-orders` · `/wallet` · `/notifications` · صفحات الأقسام؟

**تشغيلياً: لا.** لا طلبات ولا محفظة ولا إشعارات ولا تتبع داخلها.

ما يبدو «فريداً» هو كثافة روابط التصنيف في مكان واحد. نفس الفلاتر موجودة أصلاً في صفحات الأقسام:

- `/restaurants` عبر `restaurant-cuisines.js` + `section-hub-restaurants.js` (نفس slugs: kabsa_bukhari …)
- `/stores` عبر `section-hub-stores.js` (نفس types: vegetables، beauty_care، home_business …)
- `/services` عبر `section-hub-services.js` (plumber، electrician، …)
- `/` لها أبواب أقسام مع فروع أقل كثافة، لكنها أغنى تسويقياً (بنرات، متاجر حية، كيف تعمل)

**فريد شكلياً فقط (ليس تشغيلياً):**

1. بطاقة الملف: الدور + الجوال
2. تنبيه أدمن + رابط `/admin`
3. بنر مستقل `guest_dashboard` / `visitor_dashboard` (منفصل عن بنرات `/`)
4. تحويل المندوب من هذه الصفحة إلى `/driver`
5. CSS ميت لنموذج توصيل (بدون النموذج)

هذه لا تغطي فجوة في `/my-orders` أو `/wallet` أو `/notifications`.

---

## 6. هل تعتمد عليها روابط حية؟

نعم — **Navigation فقط**، ليست دورة عمل.

| المصدر | الاعتماد | ماذا يحدث اليوم |
| --- | --- | --- |
| هيدر guest-shell | نعم | رابط ثابت «منصة ERVENOW» → `/dashboard` لجميع غير البوابات التشغيلية |
| هيدر `/` | نعم | «منصة ERVENOW» + قائمة «الإعدادات» → `/dashboard` |
| شريط سفلي | جزئي | `/dashboard` يُطابق تبويب «استكشاف» للضيف و«حسابي» إن وُجد توكن. زر «حسابي» نفسه يفتح `resolvePostLoginPath` = `/` للعميل، **ليس** `/dashboard` |
| Login | لا كوجهة بعد الدخول | `CUSTOMER_PLATFORM_HOME = "/"` · `resolvePostLoginPath({role:"customer"}) === "/"` · الهيدر في login فيه رابط تصفّح إلى `/dashboard` فقط |
| Account | لا صفحة `/account` | غير موجودة. «حسابي» في الجوال → `/` |
| Notifications | لا | `notification-center.js` → `/notifications` فقط |
| Checkout | هيدر فقط | رابط guest-shell. `cart-ui.js` فيه `continueHref` افتراضي `/dashboard` لكن `cart.html` يستخدم `checkoutV3` ويتجاوز هذا الافتراضي |
| Order tracking | هيدر فقط | `/track` يضع «منصة ERVENOW» نشطاً نحو `/dashboard` |
| my-orders | نعم | زر فارغ «ابدأ طلباً جديداً» → `/dashboard` |
| delivery-map | نعم | زر رجوع → `/dashboard` |
| wallet | نعم | أيقونة «منصة ERVENOW» → `/dashboard` |
| بنرات أدمن | نعم | placement `guest_dashboard` / target `visitor_dashboard` |

عشرات الصفحات تكرر نفس رابط الهيدر: checkout، cart، stores، restaurants، services، browse، live-map، login، legal، …

---

## 7. هل يوجد Backend أو API مخصص لها فقط؟

**لا.**

- السيرفر: `sendFile(dashboard.html)` فقط
- العروض: `GET /api/core/platform-offers` عام (يُستخدم أيضاً من أدمن العروض)
- البنرات: placement `guest_dashboard` في `bannerPlacements.js` — إعداد تسويق مرتبط بالصفحة، ليس API تشغيلي
- `/api/services/me/dashboard` ليس لهذه الصفحة

---

## 8. هل حذفها سيكسر الجلسة / الطلبات / المحفظة / الإشعارات / التتبع / Navigation؟

| المجال | يكسر؟ | السبب |
| --- | --- | --- |
| الجلسة | لا | التوكن في localStorage؛ الصفحة تقرأ ولا تُنشئ الجلسة |
| الطلبات | لا | الدورة في `/my-orders` وcheckout وAPIs الطلب |
| المحفظة | لا | `/wallet.html` مستقل |
| الإشعارات | لا | الجرس من guest-shell → `/notifications` |
| التتبع | لا | `/track` مستقل |
| Login بعد الدخول | لا | الوجهة الرسمية `/` |
| Navigation | **نعم إن حُذفت بلا Redirect** | عشرات `href="/dashboard"` ستعطي 404. Redirect 302 يبقيها حيّة |

---

## 9. هل هناك بيانات أو UI فريدة يجب نقلها قبل الحذف؟

قبل Redirect (لاحقًا)، لا حاجة لنقل منطق تشغيلي. يُنصح فقط بقرار صريح على:

1. **بطاقة الملف (دور + جوال)** — مرشّحة لصفحة `/account` مستقبلية، ليست شرطًا لـ Redirect إلى `/`
2. **شبكات التصنيف الأدق** — موجودة في `/restaurants` · `/stores` · `/services`؛ لا تُحذف من هناك
3. **بنر `guest_dashboard`** — إيقاف أو دمج في بنرات `/` بقرار تسويق
4. **زر «ابدأ طلباً جديداً»** في `/my-orders` — الأفضل أن يصبح `/` لا `/dashboard`
5. **رجوع `/delivery-map`** — الأفضل `/` أو `/delivery-services.html`
6. **تسمية «الإعدادات» في قائمة `/`** — اليوم تفتح `/dashboard` ولا توجد إعدادات حقيقية هناك
7. اختبار `tests/unit/checkoutDraftEdit.test.js` يقرأ `public/dashboard.html` (رابط السلة)

لا عناوين محفوظة، لا طلبات، لا رصيد، لا مسودة طلب مخزّنة داخل الصفحة.

---

## 10. تصنيف الصفحة الآن

| النوع | الحكم |
| --- | --- |
| صفحة تشغيلية مهمة | لا |
| Account Center | لا — `/account` غير موجودة؛ البطاقة ضعيفة جداً |
| صفحة استكشاف | جزئياً — تبويبات روابط. الاستكشاف الأقوى هو `/` + صفحات الأقسام + `/start-now` |
| Legacy | نعم — اسم Dashboard وبقايا CSS توصيل |
| Duplicate | **نعم — هذا هو الوصف الأدق** |

ثالث منزل تصفّح بجانب `/` و`/start-now`.

---

## القرار الهندسي

### Option A — الإبقاء: مرفوض

يُبقي ثلاثة منازل وخلط «منصة / إعدادات / حسابي».

### Option B — تحويلها إلى `/account`: مرفوض كتحويل مباشر

محتوى الصفحة = تصفّح أقسام. نقله إلى `/account` يصنع مركز حساب مزيف مليء بتبويبات مطاعم. `/account` يجب أن تُبنى لاحقاً كصفحة روابط (طلباتي / محفظتي / إشعاراتي / خروج)، لا بإعادة تسمية هذه الصفحة.

### Option C — الإلغاء + Redirect آمن: المختار

**الوجهة: `/` وليست `/account`.**

الأسباب:

1. منزل العميل الرسمي بعد Login هو أصلاً `/` (`CUSTOMER_PLATFORM_HOME`)
2. شريط الجوال «حسابي» للعميل يفتح `/` أصلاً
3. `/account` غير موجودة؛ Redirect إليها الآن = 404
4. وظيفة التصفّح مغطاة بـ `/` وصفحات الأقسام
5. Redirect إلى `/` لا يمس الجلسة ولا الطلبات ولا المحفظة

شرط التنفيذ اللاحق (ليس الآن): الإبقاء على الملف مؤقتاً + `302 /dashboard → /` + إعادة تسمية روابط «منصة ERVENOW» حتى لا يبقى رابطان إلى نفس المنزل.

حتى الموافقة: لا Redirect ولا حذف.
