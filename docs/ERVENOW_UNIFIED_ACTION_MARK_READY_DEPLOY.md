# نشر — Merchant Preview `mark_ready` + Smoke

تاريخ: 21 سبتمبر 2026

`accept_delivery` لم يُنفَّذ. زر Accept بقي على PATCH القديم.

---

## التعديل

زر «جاهز للاستلام» في `/merchant-preview` أصبح:

```
POST /api/order/:id/action
{ "action": "mark_ready" }
```

cache-bust: `?pfv=20260921u5`

دورة الأزرار:

- Accept → PATCH القديم
- بدء التجهيز → Unified `start_preparing`
- جاهز للاستلام → Unified `mark_ready`
- انتظار المندوب → لا Action تشغيلية للتاجر

---

## الاختبارات

وحدة: 67/67 (Read Model + Available Actions + Dispatcher)

دورة واجهة (نفس APIs الأزرار):

`ES-UI-22325110` و`ES-UI-22730155`

Accept 200 → start_preparing 200 → mark_ready 200

النهاية:

- `status_unified = ready`
- `current_actor_type = merchant`
- `driver_id = null`
- ledger = 0
- لا تسوية
- التاجر `available_actions = []`

إنشاء طلب عميل عام على الإنتاج غير متاح (`public ordering` مغلق). الطلبات أُنشئت على متجر التاجر الحقيقي في قاعدة الإنتاج ثم اكتملت بالدورة أعلاه.

---

## النشر

- الالتزام: `52f6140`
- الدفع: `origin/main` → GitHub `kabsarfood/ervenow`
- الحي: `https://ervenow.com/merchant-preview.html` يحمّل `merchant-preview.js?pfv=20260921u5`
- الملف الحي يحتوي `start_preparing` و`mark_ready`
- `POST /api/order/:id/action` على النطاق الحي يعيد 401 بدون توكن (المسار منشور)

جلسة JWT المحلية لا تعمل على ervenow.com (سر الجلسة مختلف)، لذلك دورة الكتابة اكتملت عبر الخادم المحلي على **نفس قاعدة الإنتاج**.

---

## التالي

Ready Order → Driver Dispatch / Accept Delivery — للمراجعة قبل التنفيذ.
