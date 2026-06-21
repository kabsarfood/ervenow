# ERVENOW LPG Pricing Policy Review

**تاريخ المراجعة:** 2026-06-20  
**السياق:** إغلاق sprint تعبئة الغاز المركزي — قرار سياسة التسعير قبل الإنتاج.

---

## الوضع الحالي (مُنفَّذ في الكود)

| البند | القيمة |
|-------|--------|
| سعر العميل | **0.90 ر.س / لتر** |
| شرائح اللترات | 250 · 500 · 1000 · 2000 · 3000 · 4000 |
| عمولة المنصة | **7%** من `total_amount` |
| حصة المزود (`provider_net`) | `total_amount − platform_commission` |
| إيداع المحفظة (بعد P0-1) | **`provider_net`** (Option A) |

**مثال 1000 لتر:**

| البند | SAR |
|-------|-----|
| Total Amount | 900.00 |
| Platform Commission (7%) | 63.00 |
| Provider Net | 837.00 |
| Ledger Credit | **837.00** ✓ |

---

## البديل المقترح (نموذج المستخدم)

| البند | القيمة |
|-------|--------|
| سعر العميل | **1.00 ر.س / لتر** |
| حصة المزود | **0.90 ر.س / لتر** (ثابت) |
| حصة المنصة | **0.10 ر.س / لتر** (ثابت) |

**مثال 1000 لتر:**

| البند | SAR |
|-------|-----|
| Total Amount | 1,000.00 |
| Provider Net | 900.00 |
| Platform Commission | 100.00 |
| Ledger Credit | 900.00 |

---

## مقارنة الأثر

### 1. التسوية

| | **0.90 + 7%** (حالي) | **1.00 / 0.90 / 0.10** |
|---|----------------------|-------------------------|
| آلية عمولة | نسبة متغيرة (7%) | split ثابت per-liter |
| 1000L provider net | 837 | 900 |
| 1000L platform | 63 | 100 |
| Ledger (Option A) | 837 | 900 |
| تناسق أسطوانات | مختلف (2 ر.س ثابت/أسطوانة) | يمكن توحيد split/liter logic |

### 2. المحفظة

| | **0.90 + 7%** | **1.00 / 0.90 / 0.10** |
|---|---------------|-------------------------|
| إيداع المزود | `provider_net` | `liters × 0.90` |
| شفافية للمزود | «900 − 7%» | «1000L × 0.90» — أوضح |
| تغيير مطلوب | ✅ مُطبَّق (P0-1) | يحتاج `CENTRAL_*` constants + UI |

### 3. التقارير المالية

| | **0.90 + 7%** | **1.00 / 0.90 / 0.10** |
|---|---------------|-------------------------|
| `platform_commission` | 63 (7%) | 100 (10%) |
| `total_amount` | 900 | 1000 |
| revenue per 1000L | +63 | +100 (+58.7%) |
| customer cost | −100 vs alt | baseline |

---

## التوصية

### للإغلاق الفوري (هذا Sprint)

**الإبقاء على 0.90 ر.س/لتر + 7%** مع **Option A settlement** — لا تغيير تسعير الآن؛ التسوية أصبحت صحيحة.

### للمرحلة التالية (Product decision)

إذا أُريد **1.00 / 0.90 / 0.10**:

1. إضافة `GAS_CENTRAL_CUSTOMER_PER_LITER = 1.0`, `GAS_CENTRAL_PROVIDER_PER_LITER = 0.9`, `GAS_CENTRAL_PLATFORM_PER_LITER = 0.1` في `gasDeliveryPricing.js`
2. استبدال `computeGasPlatformCommission(central)` بـ `liters × 0.10`
3. تحديث `gas-delivery.html` + `GET /api/services/gas/pricing`
4. backfill غير مطلوب للطلبات الجديدة فقط

---

## قرار Sprint

| البند | القرار |
|-------|--------|
| Settlement | **Option A** — Ledger Credit = Provider Net ✅ |
| Pricing policy | **Maintain 0.90/L + 7%** until product sign-off on 1.00 model |
