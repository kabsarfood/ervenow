# ERVENOW — Merchant Completion Report

> Date: 2026-06-17  
> Portal: `/merchant-preview`  
> Launch status: **`merchant.live = true`**

---

## Executive summary

Merchant Portal has moved from **draft preview** to an **operational unified portal**. All priority gaps from the Portal Audit Report are closed for Merchant.

| القسم | الحالة | التفاصيل |
| ----- | ------ | -------- |
| **Orders** | ✅ | تبويبات workflow · قبول/تجهيز/جاهز · `order-board` + status API |
| **Products** | ✅ | CRUD كامل · عروض · ربط بالفئات |
| **Categories** | ✅ | عرض · إنشاء · تعديل · حذف · ترتيب · عدد المنتجات |
| **Wallet** | ✅ | رصيد · أرباح · عمولات · آخر العمليات من `merchant-dashboard` |
| **Withdrawals** | ✅ | متاح/معلّق/إجمالي مسحوب · إنشاء طلب · سبب الرفض · رقم العملية |
| **Notifications** | ✅ | مركز داخل البوابة · فلترة بالنوع · مقروء/غير مقروء |

---

## 1. Categories

| الميزة | API | UI |
| ------ | --- | -- |
| عرض الفئات | `GET /api/store/merchant-categories` | جدول بكل الفئات |
| إنشاء | `POST /api/store/merchant-categories` | نموذج slug + اسم + أيقونة |
| تعديل | `PUT /api/store/merchant-categories/:slug` | تحرير من الجدول |
| حذف | `DELETE /api/store/merchant-categories/:slug` | حذف (غير الافتراضية، بلا منتجات) |
| ترتيب | `PATCH /api/store/merchant-categories/reorder` | أزرار ▲ ▼ |
| عدد المنتجات | مدمج في GET | عمود «منتجات» |

---

## 2. Withdrawals

| الميزة | التنفيذ |
| ------ | ------- |
| الرصيد المتاح | `available` من محفظة المتجر ناقص الطلبات المعلّقة |
| الرصيد المعلق | `pending_reserved` |
| إجمالي السحوبات | `total_withdrawn` (طلبات `approved`) |
| إنشاء طلب | `POST /api/store/withdrawals` + تحقق IBAN |
| حالة الطلب | pending · approved · rejected |
| رقم العملية | UUID كامل في الجدول |
| سبب الرفض | `rejection_reason` — migration: `shared/migration_store_withdrawals_rejection_reason.sql` |
| Wallet Routing | `portal_type: merchant` في استجابة API · `walletPortalRouting` |

---

## 3. Notifications Center

| الميزة | التنفيذ |
| ------ | ------- |
| داخل البوابة | `ErvenowPortalInlineNotifications` + `notification-center.js` |
| الكل / غير مقروء | تبويبات قياسية |
| فلترة بالنوع | طلب جديد · إلغاء · اعتماد سحب · رفض سحب · نظام |
| تعليم كمقروء | نقرة على الإشعار |
| تعليم الكل | زر «تحديد الكل كمقروء» |
| أحداث مربوطة | `merchant.order.*` · `merchant.withdraw.*` عبر `notificationEvents.js` |
| فلترة البوابة | `filterNotificationsForPortal` في `/api/notifications` |

---

## 4. Empty screens & placeholders

| العنصر | الحالة |
| ------ | ------ |
| Categories | ✅ مكتمل |
| Withdrawals | ✅ مكتمل |
| Notifications | ✅ مكتمل (لا redirect لـ `/notifications`) |
| POS | 🔒 مخفي — `ervenow_pos: disabled` في Platform Modules |
| Meshwar | 🔒 غير موجود في قائمة التاجر |

---

## 5. Live readiness

```json
{
  "live": {
    "merchant": true
  }
}
```

- Post-login path: `/merchant-preview` (`portalPathForRole("merchant")`)
- Banner: «ERVENOW Merchant — Portal 2.0» (ليس draft)
- Classic fallbacks: sidebar foot → `/store-dashboard` · `/order-board`

---

## 6. Recommendation — اعتماد رسمي؟

### ✅ نعم — جاهزة للاعتماد كمسار التشغيل الأساسي للتاجر

**الأسباب:**

1. جميع الأقسام الستة الأساسية تعمل داخل بوابة واحدة.
2. لا توجد شاشات فارغة في المسار الرئيسي.
3. السحوبات والإشعارات مربوطة بمحركات Wallet و Notification Routing.
4. `live: true` مفعّل — التوجيه بعد تسجيل الدخول يذهب للبوابة الجديدة.

### ⚠️ شروط قبل إيقاف Store Dashboard كلياً

| الشرط | الحالة |
| ----- | ------ |
| E2E: طلب → إشعار → محفظة → سحب | ⏳ اختبار يدوي على بيئة الإنتاج |
| تشغيل migration `rejection_reason` في Supabase | ⏳ إن لم يُنفَّذ بعد |
| POS | يبقى خارج النطاق حتى تفعيل `ervenow_pos` |
| Meshwar / Loyalty | **ممنوع البدء** قبل اعتماد هذا التقرير |

### مسار انتقالي مقترح

1. **الآن:** Merchant Portal = المسار الافتراضي بعد الدخول.
2. **4 أسابيع:** الإبقاء على `/store-dashboard` كـ fallback في sidebar foot.
3. **بعد E2E ناجح:** إزالة روابط «الكلاسيكية» تدريجياً (قرار إداري).

---

## 7. Manual test checklist

```
□ تسجيل دخول تاجر → /merchant-preview
□ Categories: إنشاء فئة → إضافة منتج بها → ترتيب → تعديل → حذف (فارغة)
□ Orders: طلب جديد → تغيير حالة → إشعار في المركز
□ Withdrawals: طلب سحب → يظهر pending → (أدمن) رفض مع سبب → يظهر للتاجر
□ Notifications: فلتر «طلب جديد» · «رفض سحب» · تحديد كمقروء
□ POS غير ظاهر في القائمة
```

---

## 8. Key files

| Area | Path |
| ---- | ---- |
| Merchant UI | `public/assets/merchant-preview.js` |
| Categories API | `apps/store/routes.js` → `/merchant-categories` |
| Withdrawals API | `apps/store/routes.js` → `/withdrawals` |
| Notifications UI | `public/assets/notification-center.js` |
| Platform Modules | `public/assets/portal-framework/portal-platform-modules.js` |
| Launch config | `shared/utils/portalLaunch.js` |
