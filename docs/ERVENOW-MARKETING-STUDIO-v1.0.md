# ERVENOW Marketing Studio v1.0

**الإصدار:** 1.0  
**التاريخ:** 2026-07-01  
**النطاق:** الصفحة الرئيسية `/` + لوحة الإدارة  
**السياق:** مرحلة **ما بعد** اعتماد EPPC — 🏆 Production Quality Certified

**المراجع الاستراتيجية (ليست مواصفات تقنية):**
- [ERVENOW 3.0 — Experience Engineering Directive](./ERVENOW-3.0-EXPERIENCE-ENGINEERING-DIRECTIVE.md)
- [EHX — Human Experience](./ERVENOW-HUMAN-EXPERIENCE-EHX.md) — فلسفة الترحيب والسياق والرسائل
- [Marketing Studio — Vision 2030](./ERVENOW-MARKETING-STUDIO-VISION-2030.md) — رؤية المنصة الحية
- [Context Studio v1.0](./ERVENOW-CONTEXT-STUDIO-v1.0.md) — محرك السياق (مخطَّط)

**المراجع التقنية:**
- [EPPC v1.0](./ERVENOW-PLATFORM-POLISHING-CYCLE-EPPC.md)
- [Platform Certification Board](./PLATFORM-CERTIFICATION-BOARD.md)

---

## 1. الغرض

تحويل الصفحة الرئيسية من صفحة **معتمدة وجميلة** إلى صفحة **حية ومتجددة** — مركز تسويق ذكي — **دون التراجع** عن إنجازات EPPC.

| هذه المرحلة | ليست |
|-------------|------|
| نظام تسويق قابل للإدارة بالكامل | إعادة تصميم كاملة |
| إضافة عناصر تندمج مع الهوية الحالية | عناصر عشوائية تنافس البطل البصري |
| توسعة مُخطَّطة مع بوابات جودة | كسر Eye Flow أو Focus Score |

---

## 2. خط أحمر — ممنوع التراجع

أي عنصر Marketing Studio **يجب أن يجتاز** قبل الإطلاق:

| معيار EPPC | شرط القبول |
|------------|------------|
| Eye Flow | لا يقطع المسار: هيدر → بنر → أقسام → ثقة |
| Focus Score | البطل يبقى **بطاقات الأقسام الأربعة** |
| Noise Score | لا تكرار محتوى (مثلاً تواصل في الفوتر + شريط + بطاقة) |
| Cognitive Load | ≤ 3 قرارات فوق الطية على الجوال |
| Performance | LCP/CLS ضمن حدود EPPC؛ لا حركات ثقيلة |
| Accessibility | تباين · SR · `prefers-reduced-motion` |
| Mobile / Desktop | كل شريحة 320–1440+ |

**قاعدة ذهبية:** إذا زاد Noise أو قل Focus → العنصر يُخفى افتراضياً أو يُعاد تصميمه.

---

## 3. فلسفة التجربة

الصفحة يجب أن تشعر المستخدم بأنها:

- حية · متجددة · احترافية · راقية · سريعة · غير مزدحمة

الهدف ليس كثرة العناصر — بل إحساس أن المنصة **تتغير يومياً** دون إزعاج.

### هوية بصرية (ثابتة)

- البني الملكي · الذهبي · الكريمي · الأبيض
- تدرجات ناعمة · حدود ذهبية رفيعة · ظلال خفيفة
- حركات: fade/slide قصيرة · قابلة للإيقاف مع `prefers-reduced-motion`

---

## 4. الوضع الحالي في الكود (Baseline)

| القدرة | موجود اليوم | المسار |
|--------|-------------|--------|
| Hero Banner (رئيسية) | ✅ | `GET /api/core/banners?target=home` · `guest-offers-carousel.js` · `#homeMainBanner` |
| بنرات أقسام أخرى | ✅ | `hero_banners` · `admin/modules/hero-banners.js` |
| عروض منصة (شرائح) | ✅ جزئياً | `GET /api/core/platform-offers` · `admin/modules/offers.js` |
| إدارة من لوحة التحكم | ✅ منفصلة | بنرات + عروض في تبويبات مختلفة |
| Announcement Bar | ❌ | — |
| Promotional Cards | ❌ | — |
| Flash Campaign | ❌ | — |
| Featured Collections | ❌ | — |
| Featured Merchants | ❌ | — |
| Seasonal Campaigns | ❌ | — |
| Marketing Widgets | ❌ | — |
| App Promotion | ❌ | — |
| Dynamic Home Layout | ❌ | — |

**قرار معماري:** Marketing Studio **يوحّد** الإدارة و**يوسّع** النموذج — لا يستبدل ما يعمل إن أمكن.

---

## 5. وحدات Marketing Studio

### 5.1 Smart Announcement Bar

شريط أعلى الصفحة (تحت الهيدر أو فوقه — يُحدد في Layout Manager).

| حقل | نوع |
|-----|-----|
| `messages[]` | نص · رابط اختياري · أولوية |
| `rotation_ms` | مدة العرض |
| `starts_at` / `ends_at` | جدولة |
| `audience` | `all` · `guest` · `logged_in` |
| `cities[]` | استهداف مدن (مستقبلاً) |
| `animation` | `fade` · `slide` · `none` |
| `is_active` | إخفاء/إظهار |

**Eye Flow:** ضيق الارتفاع (≤ 40px جوال) · لا يدفع البطل · dismiss اختياري.

---

### 5.2 Hero Marketing Banner

**توسيع** `hero_banners` الحالي — لا جدول منفصل إن أمكن.

يدعم من الإدارة: صورة · عنوان · وصف · زر · رابط · ترتيب · مدة · مدن · نوع مستخدم · بداية/نهاية · (فيديو لاحقاً).

**الواجهة:** `#homeMainBanner` — carousel موجود · يبقى تحت الهيدر.

---

### 5.3 Promotional Cards

بطاقات أسفل الأقسام (بعد hub أو بعد `#why` — يُحدد في Layout).

| حقل | ملاحظة |
|-----|--------|
| صورة · لون خلفية · نسبة خصم | |
| عنوان · وصف · CTA · رابط | |
| `ends_at` | عداد انتهاء اختياري |

**Focus:** لا تتجاوز 2–3 بطاقات نشطة في الطية الأولى.

---

### 5.4 Flash Campaign

وميض ذهبي **مرة واحدة** عند أول ظهور في الجلسة.

- CSS `@keyframes` قصير (≤ 600ms)
- `sessionStorage` لمنع التكرار
- معطّل تلقائياً مع `prefers-reduced-motion: reduce`

---

### 5.5 Featured Collections

أقسام ديناميكية: أشهر المطاعم · أفضل البرجر · عروض الأسبوع · …

| حقل | |
|-----|--|
| `collection_type` | `restaurants` · `stores` · `services` · `mixed` |
| `query` / `entity_ids[]` | مصدر البيانات |
| `title_ar` · `subtitle_ar` · `see_all_url` | |
| `sort_order` · `is_active` | |

---

### 5.6 Featured Merchants

إبراز كيانات محددة (مطعم · متجر · خدمة) — بطاقات أفقية scroll أو grid صغير.

---

### 5.7 Seasonal Campaigns

حزم جاهزة (رمضان · عيد · وطني · …) تفعّل مجموعة عناصر:

- ثيم ألوان خفيف · بنر · announcement · promotional cards

`preset_id` + `schedule` + `enabled`.

---

### 5.8 Marketing Widgets

وحدات صغيرة قابلة للإدراج:

- عد تنازلي · نسبة خصم · كوبون · إعلان محدود

كل widget: `type` · `config` (JSON) · `slot` · `priority`.

---

### 5.9 App Promotion

بطاقة تحميل التطبيق — عنوان · وصف · روابط iOS/Android · `is_active`.

---

### 5.10 Dynamic Home Layout (Home Experience Manager)

**Home Experience Manager** — قلب النظام.

```json
{
  "version": 1,
  "sections": [
    { "id": "announcement_bar", "enabled": true, "order": 10 },
    { "id": "header", "enabled": true, "order": 20, "locked": true },
    { "id": "hero_banner", "enabled": true, "order": 30 },
    { "id": "hub", "enabled": true, "order": 40, "locked": true },
    { "id": "trust", "enabled": true, "order": 50 },
    { "id": "promotional_cards", "enabled": false, "order": 60 },
    { "id": "why", "enabled": true, "order": 70 },
    { "id": "featured_collections", "enabled": false, "order": 80 },
    { "id": "cta_cards", "enabled": true, "order": 90 },
    { "id": "app_promotion", "enabled": false, "order": 100 },
    { "id": "footer", "enabled": true, "order": 110, "locked": true }
  ]
}
```

- أقسام `locked` لا تُحذف — فقط ترتيب محدود
- البطل (`hub`) دائماً في الطية الأولى

---

## 6. لوحة الإدارة — ERVENOW Marketing Studio

قسم جديد موحّد في `/admin`:

| تبويب | يغطي |
|-------|------|
| Announcement Bar | §5.1 |
| Hero Banner | §5.2 (ترحيل من hero-banners للرئيسية) |
| Promotional Cards | §5.3 |
| Flash Campaigns | §5.4 |
| Featured Collections | §5.5 |
| Featured Merchants | §5.6 |
| Seasonal Campaigns | §5.7 |
| Marketing Widgets | §5.8 |
| App Promotion | §5.9 |
| Home Experience Manager | §5.10 |

**ملفات مقترحة:**

```
public/admin/modules/marketing-studio/
  index.js          # shell + routing
  announcement.js
  hero.js           # يلتف حول hero-banners API
  promotional.js
  flash.js
  collections.js
  merchants.js
  seasonal.js
  widgets.js
  app-promo.js
  layout.js
public/assets/marketing-studio/
  home-renderer.js  # يقرأ layout + يحقن DOM
  home-marketing.css
```

---

## 7. طبقة البيانات والـ API

### 7.1 تخزين مقترح

| جدول / ملف | محتوى |
|------------|--------|
| `hero_banners` | موجود — Hero §5.2 |
| `platform_offers` / JSON | موجود — يُدمج أو يُستبدل تدريجياً |
| `marketing_announcements` | جديد — §5.1 |
| `marketing_promotional_cards` | جديد — §5.3 |
| `marketing_campaigns` | جديد — flash + seasonal |
| `marketing_collections` | جديد — §5.5–5.6 |
| `marketing_widgets` | جديد — §5.8 |
| `marketing_app_promo` | جديد — §5.9 |
| `marketing_home_layout` | جديد — JSON §5.10 |

بديل MVP: ملف `data/marketing-home.json` + API قراءة/كتابة admin حتى اكتمال migrations.

### 7.2 API عام (ضيف)

```
GET  /api/core/marketing/home
     → { layout, announcement, hero, promotional[], collections[], widgets, app_promo, campaigns }
```

استجابة واحدة · cache قصير (60s) · fallback للوضع الحالي إن فارغ.

### 7.3 API إدارة

```
GET/PUT  /api/admin/marketing/*
```

محمي بـ `requireRole('admin')`.

---

## 8. دمج الواجهة (Home) دون كسر EPPC

### ترتيب Eye Flow المعتمد (مع Marketing)

```
هيدر (ثابت)
→ [announcement bar]  اختياري · ضيق
→ بنر رئيسي         اختياري
→ أقسام hub         بطل · ثابت
→ ثقة
→ [promotional]     اختياري · بعد الثقة
→ why + CTA
→ [collections / widgets / app]  اختياري · أسفل الطية
→ فوتر
```

### قواعد DOM

- كل قسم marketing: `data-marketing-slot="…"`
- تحميل كسول للأقسام تحت الطية
- placeholder بارتفاع ثابت للبنر (موجود) — يبقى
- لا `min-height` على hub يدفع الثقة لأسفل (إصلاح EPPC سابق)

---

## 9. خطة التنفيذ المرحلية

| مرحلة | نطاق | مخرجات | بوابة EPPC |
|-------|------|--------|------------|
| **M0** | توثيق + baseline | هذا الملف · مقاييس before | — |
| **M1** | Layout Manager + API موحّد | `marketing/home` · إخفاء/ترتيب بدون عناصر جديدة | Validation @390/@1280 |
| **M2** | Announcement Bar | admin + guest render | Focus/Noise check |
| **M3** | Hero توسيع | دمج hero-banners في Studio | carousel metrics |
| **M4** | Promotional Cards + Flash | 2 بطاقات max في الطية | reduced-motion |
| **M5** | Collections + Merchants | أسفل الطية | perf budget |
| **M6** | Seasonal + Widgets + App | حزم وجدولة | اختبار كامل |
| **M7** | اعتماد Marketing | تقرير + تحديث Certification Board | 🏆 Home + Marketing Certified |

**لا تُنفَّذ كل الوحدات دفعة واحدة.**

---

## 10. اختبار واعتماد

لكل مرحلة:

1. `scripts/p1c-home-validation.js` — قبل/بعد
2. Focus / Noise / Cognitive يدوي + لقطات
3. Lighthouse mobile (مرجعية — لا regression)
4. `prefers-reduced-motion` يدوي
5. Desktop @1280

عند اكتمال M7: إضافة صف في [Platform Certification Board](./PLATFORM-CERTIFICATION-BOARD.md):

> Home — Marketing Studio v1.0 — 🏆 Certified (مع الحفاظ على EPPC base)

---

## 11. الهدف النهائي

صفحة رئيسية **حية ومتجددة** — مركز تسويق ذكي — تُدار بالكامل من لوحة الإدارة **بدون تعديل كود** — مع **صفر تراجع** عن شهادة Production Quality Certified.

---

## 12. اعتماد M1 — Foundation Architecture (2026-07-01)

تمت الموافقة التنفيذية على M1 بالقرارات التالية:

| القرار | التفاصيل |
|--------|----------|
| الاسم الرسمي | **Home Experience Manager** (بدلاً من Home Layout Manager) |
| التوسع المستقبلي | Schema + Engine يدعمان `home` · `restaurants` · `stores` · `services` · `delivery` |
| هوية الوحدة | كل module له `id` ثابت — لا يعتمد النظام على الترتيب فقط |
| خصائص الوحدة | `id` · `name` · `visible` · `priority` · `display_order` · `animation` · `target_audience` · `cities` · `starts_at` · `ends_at` · `status` |
| حالات الوحدة | `visible` · `hidden` · `scheduled` |
| Drag & Drop | `drag_drop_ready: true` في Schema — التفعيل في مرحلة لاحقة |
| Audit Log | `data/marketing/audit-log.json` — actor · وقت · نوع · قيمة سابقة/جديدة |
| API | `GET /api/core/marketing/home` + `GET /api/core/marketing/:surface` |
| Admin API | `GET/PUT /api/admin/marketing/experiences/:surface` · `GET /api/admin/marketing/audit-log` |
| Renderer | `assets/marketing-studio/home-renderer.js` — ترتيب + ظهور فقط (M1) |

### ملفات M1

```
shared/utils/marketingEngine.js
data/marketing/experiences/home.json
data/marketing/audit-log.json
public/assets/marketing-studio/home-renderer.js
public/assets/marketing-studio/home-marketing.css
public/admin/modules/marketing-studio.js
tests/unit/marketingEngine.test.js
```

### الخطوة التالية بعد M1

**M2 — Smart Announcement Bar** (أول عنصر مرئي جديد — مع بوابة Focus/Noise)

---

## 13. الخطوة التالية المقترحة (سابقاً M1)

~~**M1 — Home Layout Manager + API موحّد**~~ → **مُنفَّذ** — راجع §12.

بعد validation EPPC @390/@1280 — ابدأ **M2**.
