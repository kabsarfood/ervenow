# ERVENOW Naming Standard v1.0

**النوع:** سياسة معتمدة — مرجع تسمية رسمي  
**الإصدار:** 1.0  
**التاريخ:** 2026-07-03  
**الحالة:** ✅ معتمد

---

## الهدف

توحيد جميع أسماء الأنظمة والمحركات والواجهات والجداول وواجهات البرمجة داخل ERVENOW.

الهدف من هذه الوثيقة هو أن يتحدث جميع أفراد الفريق «لغة واحدة»، وأن تبقى المصطلحات ثابتة عبر السنوات.

---

## المبادئ

### 1. الاسم يصف الوظيفة

لا نختار أسماء جميلة فقط. بل أسماء تعيش سنوات وتعبر عن وظيفة المكوّن.

### 2. لا نربط الاسم بميزة واحدة

إذا كان المكوّن سيستخدمه أكثر من نظام، فلا يُسمّى باسم ميزة واحدة.

| مرفوض | معتمد |
|-------|--------|
| `LiveOrderServiceProfiles` | **Service Profiles** |

### 3. نستخدم كلمة Engine عند وجود منطق وتشغيل

مثل: **Live Order Engine** · **Settlement Engine** · **Capability Engine**

ولا تُستخدم للمكوّنات الثابتة.

### 4. نستخدم كلمة Studio للأنظمة الإدارية

مثل: **Marketing Studio** · **Context Studio**

### 5. نستخدم كلمة Profile لتعريف أنواع الخدمات

مثل: **Restaurant Profile** · **Gas Profile** · **Service Profile**

### 6. نستخدم كلمة Experience عندما يتعلق الأمر برحلة المستخدم

مثل: **Experience Engineering** · **Experience Rules**

---

## المصطلحات الرسمية

| المصطلح | الوصف | الحالة |
|---------|--------|--------|
| **Live Order Engine** | المحرك المسؤول عن إدارة الطلب حتى نقطة الإغلاق | ✅ معتمد |
| **Service Profiles** | المرجع الرسمي الذي يصف خصائص كل خدمة | ✅ معتمد |
| **Experience Rules** | القواعد التي تتحكم في سلوك المنصة وتجربة المستخدم | ✅ معتمد |
| **Capability Engine** | المحرك المسؤول عن تحديد الإمكانيات المسموح بها لكل خدمة وكل حالة | ✅ معتمد |
| **Settlement Engine** | المحرك المسؤول عن تسوية الفروقات المالية | ✅ معتمد |
| **Marketing Studio** | منصة إدارة المحتوى والحملات | ✅ معتمد |
| **Context Studio** | منصة إدارة السياق | ✅ معتمد |
| **Experience Engineering** | المنهج المسؤول عن بناء التجربة | ✅ معتمد |
| **Human Experience (EHX)** | الجانب الإنساني في تجربة المستخدم | ✅ معتمد |
| **Living Experience** | النتيجة النهائية لتفاعل جميع المحركات مع المستخدم | ✅ معتمد |

> **ملاحظة ترحيل:** المصطلح السابق *Permission Engine* — **مُستبدَل رسمياً** بـ **Capability Engine**.

---

## قواعد تسمية قواعد البيانات

يفضل أن تكون أسماء الجداول **عامة** وقابلة لإعادة الاستخدام.

| معتمد | غير مفضل |
|-------|----------|
| `service_profiles` | `live_order_service_profiles` |
| `amendments` | `order_amendments` |
| `settlements` | `order_amendment_ledger_entries` |
| `capability_rules` | `live_order_permissions` |
| `experience_rules` | — |
| `marketing_campaigns` | — |
| `context_events` | — |

لا يُفضَّل ربط اسم الجدول بميزة واحدة إذا كان سيُستخدم لاحقاً في أكثر من نظام.

---

## قواعد تسمية APIs

تعتمد أسماء واجهات البرمجة على **المورد (Resource)** وليس على اسم المحرك.

| معتمد | غير مفضل |
|-------|----------|
| `GET /api/orders` | `GET /api/live-order/...` |
| `GET /api/orders/{id}` | `GET /api/order/:id` |
| `GET /api/orders/{id}/service-profile` | `GET /api/order/:id/live-order/profile` |
| `GET /api/orders/{id}/amendments` | — |
| `POST /api/orders/{id}/amendments/preview` | `POST .../live-order/preview` |
| `GET /api/orders/{id}/settlements` | — |
| `GET /api/admin/service-profiles` | `GET /api/admin/live-order/profiles` |
| `GET /api/admin/capability-rules` | `GET /api/admin/live-order/permissions` |
| `GET /api/marketing` | — |
| `GET /api/context` | — |

**الاسم التجاري في الواجهة:** «إدارة الطلب» — **الاسم الداخلي:** Live Order Engine.

---

## قواعد تسمية الملفات

أسماء مستقرة **غير مرتبطة بإصدار**:

```text
shared/domain/live-order-engine/
  service-profiles.js
  capability-engine.js
  live-order-engine.js
  settlement-engine.js
  experience-rules.js
```

---

## الكلمات المحجوزة

تُستخدم بحذر شديد: **Core** · **Global** · **Universal** · **Master**

ولا تُستخدم إلا إذا كان المكوّن يمثل نواة المنصة فعلاً.

---

## الكلمات غير المفضلة

يُفضَّل تجنب: **Manager** · **Helper** · **Utils** · **Temp** · **New** · **Old** · **Legacy** · **Config** · **Generic**

إلا إذا كان الاستخدام يعبر فعلاً عن وظيفة الملف.

---

## المبدأ الذهبي

إذا احتجنا إلى شرح الاسم في كل اجتماع، فهو ليس الاسم المناسب.

أما إذا فهمه المطور ومدير المنتج وفريق الجودة مباشرة، فهو الاسم الصحيح.

---

## تطبيق على Live Order™ (مرجع سريع)

```text
Service Type
    ↓
Service Profiles          (جدول: service_profiles)
    ↓
Capability Engine         (جدول: capability_rules · experience_rules)
    ↓
Live Order Engine         (جدول: amendments)
    ↓
Settlement Engine         (جدول: settlements)
```

| طبقة قديمة (v2.1) | المصطلح الرسمي v1.0 |
|-------------------|----------------------|
| Permission Engine | **Capability Engine** |
| Business Rules (تقييم حالة) | داخل **Capability Engine** |
| Ledger / تسوية جزئية | **Settlement Engine** |
| `order_amendments` | `amendments` |

---

## مستندات مرتبطة

| المستند | العلاقة |
|---------|---------|
| [ERVENOW-LIVE-ORDER-v2-ARCHITECTURE.md](./ERVENOW-LIVE-ORDER-v2-ARCHITECTURE.md) | تطبيق المعيار على Live Order |
| [ERVENOW-LIVE-ORDER-LOFS.md](./ERVENOW-LIVE-ORDER-LOFS.md) | مواصفات وظيفية |
| [ERVENOW-3.0-EXPERIENCE-ENGINEERING-DIRECTIVE.md](./ERVENOW-3.0-EXPERIENCE-ENGINEERING-DIRECTIVE.md) | Experience Engineering |

---

**الهدف النهائي:** لغة هندسية موحدة — مكونات · وثائق · كود — متناسقة مع توسع المنصة.
