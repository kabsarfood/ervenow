# ERVENOW Platform Quality Standard v1.0

**الإصدار:** 1.0  
**التاريخ:** 2026-07-01  
**النطاق:** جميع صفحات وبوابات ERVENOW  
**السياسة الرسمية:** [ERVENOW Engineering Policy](./ERVENOW-ENGINEERING-POLICY.md)  
**الدورة الرسمية:** [EPPC v1.0](./ERVENOW-PLATFORM-POLISHING-CYCLE-EPPC.md)  
**لوحة الاعتماد:** [Platform Certification Board](./PLATFORM-CERTIFICATION-BOARD.md)

---

## 1. الغرض

هذه الوثيقة هي **المعيار الداخلي الرسمي** لجودة واجهات ERVENOW.  
أي صفحة أو بوابة جديدة، أو إعادة تصميم، يجب أن تُراجع وفق هذه المعايير **قبل الاعتماد للإنتاج**.

---

## 2. فلسفة الجودة

### المبدأ الأساسي
> **التصميم يشرح نفسه.**

### قواعد ثابتة
1. **الحذف قبل الإضافة** — لا عنصر بلا قيمة للمستخدم.
2. **البساطة أولاً** — كل كلمة زائدة تُحذف.
3. **الجوال أولاً** — ثم سطح المكتب بنفس الجودة.
4. **لا ميزات جديدة في مرحلة الصقل** — صقل فقط.
5. **لا تغيير** Business Logic · قاعدة البيانات · APIs إلا لعطل يمنع الاستخدام.

### تجربة الإنسان (3 ثوانٍ)
خلال أول 3 ثوانٍ يجب أن يشعر المستخدم بالترتيب:
1. **الراحة** (Comfort)
2. **الثقة** (Confidence)
3. **وضوح القرار** (Clarity)

---

## 3. منهجية المراجعة — EPPC

> **الدورة الرسمية:** [ERVENOW Platform Polishing Cycle (EPPC)](./ERVENOW-PLATFORM-POLISHING-CYCLE-EPPC.md)  
> ست مراحل: Assessment → Polishing (جولة واحدة) → Validation → القياسات → Executive Decision → Certification

### ملخص المراحل

| # | المرحلة | الوصف |
|---|---------|--------|
| 1 | **Assessment** | تقييم A/B/C — بدون تعديل |
| 2 | **Platform Polishing** | جميع التحسينات في جولة واحدة |
| 3 | **Validation** | Eye Flow · Five Second · Silent · Memory · Finger Distance · Human |
| 4 | **القياسات** | Focus · Noise · Comfort · Confidence · Elegance · Business · Smile · Useful Words |
| 5 | **Executive Decision** | 🟢 · 🟡 · 🏆 + جملة واحدة |
| 6 | **Certification** | تحديث [لوحة الاعتماد](./PLATFORM-CERTIFICATION-BOARD.md) |

### معايير Assessment (A / B / C)
- UX Ease · Visual Appeal · Premium Feel · Human Experience
- Performance · Accessibility
- Desktop Experience · Mobile Experience
- Eye Flow · Focus · Noise · Cognitive Load
- Content Simplicity · Business Experience

**معيار البدء بالصقل:** UX · Visual Appeal · Premium Feel · Content Simplicity · Performance ليست كلها **A** — أو توجد فجوات حرجة في Eye Flow / Focus.

> **ملاحظة:** منهجية P1-A / P1-B / P1-C (جولات منفصلة) **مُستبدلة** بـ EPPC. صفحة Home صُقلت سابقاً عبر P1 وتُعتبر معتمدة بأثر رجعي.

---

## 4. معايير Eye Flow (الصفحات المحورية)

### الصفحة الرئيسية (Home)
```
الهيدر → الأقسام الأربعة → شريط الثقة → بقية الصفحة
```
- على الجوال: **لا حجز مكان لبنر فارغ** بين الهيدر والأقسام.
- البنر (إن وُجد) **بعد** الأقسام على الجوال.

### صفحات الأقسام (مطاعم · متاجر · خدمات · توصيل)
يُعرّف Eye Flow لكل صفحة عند بدء صقلها — بنفس المنهجية.

---

## 5. معايير الأداء

| المؤشر | الهدف |
|--------|-------|
| CLS | ≤ 0.1 (ممتاز ≤ 0.05) |
| LCP | ≤ 2.5s (ممتاز ≤ 1.5s) |
| حجز مكان العناصر الديناميكية | فقط عند الحاجة — لا حجز لمحتوى فارغ |
| Lazy loading | للصور خارج الطية الأولى |

---

## 6. معايير الوصول (Accessibility)

- السماح بالتكبير على الصفحات العامة
- أحجام أزرار ≥ 44×44px على الجوال
- `aria-label` للعناصر التفاعلية
- تباين نص مقروء (WCAG AA حيث أمكن)
- دعم `prefers-reduced-motion`
- لا روابط `#` وهمية

---

## 7. معايير المحتوى

| القاعدة | التفصيل |
|---------|---------|
| عنوان واحد | لا عناوين مزدوجة لنفس القسم |
| البطاقة | تُفهم خلال 3 ثوانٍ |
| الوصف | سطر واحد على Desktop · اختياري على الجوال |
| الإيموجي | ممنوع في الواجهة الرئيسية — SVG موحّد |
| CTA | فعل واحد واضح لكل قسم |

---

## 8. معايير الهوية البصرية

- ألوان ERVENOW: بني `#3d2213` · ذهبي `#b9872f` · كريمي `#f8f4ee`
- خط: **Cairo**
- ظلال ناعمة — لا ظلال قاسية
- زوايا: 14–20px للبطاقات
- أيقونات: stroke 1.85 · نفس الأسلوب في كل الصفحة

---

## 9. مقاييس الاعتماد (EPPC — المرحلة 4)

| المقياس | الهدف للاعتماد |
|---------|----------------|
| **Comfort Score** | ≥ 8/10 |
| **Confidence Score** | ≥ 8/10 |
| **Elegance Score** | ≥ 8/10 |
| **Business Score** | ≥ 8/10 |
| **Focus Score** | ≥ 8/10 |
| **Noise Score** | ≤ 5/10 (أقل أفضل) |

### Silent Test
- بدون قراءة نصوص 5 ثوانٍ
- يجب معرفة **أين الضغط**
- البطل البصري = الإجراء الأساسي

### قرارات الاعتماد (صيغة واحدة فقط — EPPC المرحلة 5)
- 🟢 **معتمدة**
- 🟡 **جاهزة لجولة صقل إضافية**
- 🏆 **Production Quality Certified**

+ **جملة واحدة** تشرح سبب القرار.

---

## 10. قائمة تحقق EPPC (قبل اعتماد أي صفحة)

- [ ] **Assessment** — تقييم A/B/C + Eye Flow مستهدف
- [ ] **Polishing** — جولة واحدة (UX · UI · Premium · Human · Noise · Performance · A11y)
- [ ] **Validation** — الاختبارات الستة + قياس @390 و @1280
- [ ] **القياسات** — Focus · Noise · Comfort · Confidence · Elegance · Business · Smile
- [ ] **Executive Decision** — 🟢 / 🟡 / 🏆 + جملة واحدة
- [ ] **Certification** — تحديث [لوحة الاعتماد](./PLATFORM-CERTIFICATION-BOARD.md)
- [ ] لا ميزات جديدة · لا تغيير APIs/DB/Logic
- [ ] لقطات في `docs/screenshots/{page}-validation/`

---

## 11. مرجع تطبيقي — Home (🏆 Production Quality Certified)

| المؤشر | النهائي @390 | النهائي @1280 |
|--------|--------------|---------------|
| أول بطاقة | **116px** | **211px** |
| 4/4 أقسام في الطية | ✅ | ✅ |
| `#why` في الطية | ❌ (865px) | جزئي (773px) |
| حجز بنر فارغ | ❌ | ❌ |
| Eye Flow DOM | هيدر → أقسام → ثقة → بنر → main | نفس الترتيب |

### قرارات الجولة النهائية (Final Polish)
1. **نقل البنر في DOM** ليكون بعد قسم الأقسام على جميع المقاسات — البطل = البطاقات الأربعة.
2. **إخفاء عنوان «اختر ما يناسبك»** بصرياً (يبقى لـ screen readers).
3. **إخفاء إيموجي القائمة** على الصفحة الرئيسية.
4. **جوال:** الشعار فقط في الهيدر (بدون نص ERVENOW المكرر).
5. **Desktop:** ضغط شريط التنقل · بنر مضغوط بعد الأقسام.

**الملفات المرجعية:**
- `public/assets/home-polish-p1a.css`
- `public/assets/home-polish-p1b.css`
- `public/assets/home-polish-p1c.css`
- `public/assets/home-polish-final.css`
- `docs/screenshots/p1c-validation/`

---

## 12. تسلسل EPPC على المنصة

انظر [لوحة الاعتماد](./PLATFORM-CERTIFICATION-BOARD.md) للحالة الحية.

1. 🏆 **Home** (`/`) — Production Quality Certified  
2. 🏆 **مطاعم** (`/restaurants`) — Production Quality Certified  
3. ⏳ **متاجر** (`/stores`) — التالي  
4. ⏳ خدمات · توصيل · بقية الصفحات والبوابات

---

*ERVENOW Platform Quality Standard v1.0 — داخلي · جميع الحقوق محفوظة*
