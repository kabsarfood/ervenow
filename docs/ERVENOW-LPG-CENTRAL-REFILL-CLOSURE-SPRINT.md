# ERVENOW LPG Central Refill Closure Sprint

**تاريخ الإغلاق:** 2026-06-20  
**القرار المعتمد:** `gas_cylinder_swap` + `gas_central_refill` → **Service Portal فقط**

---

## P0-1 — LPG Settlement Audit ✅

### القرار: **Option A — Ledger Credit = Provider Net**

| البند | 1000L × 0.90 | بعد الإصلاح |
|-------|--------------|-------------|
| Total Amount | 900 | 900 |
| Provider Net | 837 | 837 |
| Platform Commission | 63 | 63 |
| Ledger Credit | ~~900~~ → **837** | ✅ |

**الملفات:**
- `shared/services/providerLedgerCredit.js` — `resolveProviderCreditAmount()`
- `tests/unit/providerLedgerCredit.test.js` — 6/6 PASS
- `docs/LPG-SETTLEMENT-VERIFICATION-REPORT.md`
- `data/lpg-settlement-verification-report.json`

**إثبات:** `node scripts/lpg-settlement-verification.js` → **PASS**

---

## P0-2 — Service Portal Synchronization ✅

إزالة الغاز من Transport في:

| ملف | التغيير |
|-----|---------|
| `ervenow-frontend/assets/role-routing.js` | `gas_*` → `SERVICE_PORTAL_TYPES` |
| `ervenow-frontend/assets/account-destinations.js` | إزالة gas من `TRANSPORT_SERVICE_TYPES` |
| `ervenow-frontend/assets/transport-preview.js` | إزالة gas types + chip + pricing KPI |
| `ervenow-frontend/assets/portal-framework/portal-operational.js` | gas → `SERVICE_ONLY_TYPES` |
| `public/assets/*` | مزامنة |

**النتيجة:** `gas_central_refill` → `/service-preview` (لم يعد `/transport-preview`)

---

## P0-3 — Partner Registration ✅

`ervenow-frontend/login.html` + `public/login.html`:

- `gas_cylinder_swap` — تبديل أسطوانة الغاز
- `gas_central_refill` — تعبئة غاز مركزي

حقول التسجيل الموجودة: **اسم النشاط** · **جوال** · **الحي/المنطقة** · **نوع الخدمة**

---

## P0-4 — Service Portal UI ✅

`ervenow-frontend/assets/service-preview.js`:

| عنصر | الحالة |
|------|--------|
| بطاقة تعبئة مركزي | ✅ منشأة/حي · موقع · لترات مطلوبة |
| بدء التعبئة | ✅ `POST .../complete` step=provider |
| اللترات الفعلية | ✅ input + validation |
| إنهاء المهمة | ✅ step=legacy + `actual_liters` |

**Backend:** `apps/services/routes.js` — `persistGasActualLiters()`

---

## P0-5 — Live E2E ⚠️

**Script:** `scripts/lpg-central-refill-live-e2e.js`  
**Usage:** `LIVE_E2E=1 node scripts/lpg-central-refill-live-e2e.js`

| المرحلة | النتيجة |
|---------|---------|
| create → service portal | ✅ (code path) |
| full lifecycle + settlement | **BLOCKED** — `no_gas_central_refill_provider` in DB |

**لإغلاق E2E:** سجّل مزود `gas_central_refill` ووافق عليه، أو عيّن `E2E_GAS_CENTRAL_PROVIDER_ID`.

---

## Pricing Policy Review

**تقرير منفصل:** `docs/ERVENOW-LPG-PRICING-POLICY-REVIEW.md`

| | Sprint decision |
|---|-----------------|
| Settlement | Option A ✅ |
| Pricing | **Maintain 0.90/L + 7%** until product sign-off on 1.00 model |

---

## Live Readiness Score (Post-Sprint)

| العنصر | قبل | بعد |
|--------|-----|-----|
| Routing | FAIL | **PASS** |
| Orders | PASS | **PASS** |
| Pricing | PASS | **PASS** |
| Wallet | PASS | **PASS** |
| Settlement | FAIL | **PASS** |
| Notifications | PASS | **PASS** |
| Service Portal | FAIL | **PASS** (code) · E2E blocked on provider |

**Service Portal: FAIL → PASS** (implementation) — Live E2E pending provider account.

---

## أوامر التحقق

```bash
node scripts/lpg-settlement-verification.js
npm test -- tests/unit/providerLedgerCredit.test.js
LIVE_E2E=1 node scripts/lpg-central-refill-live-e2e.js
node scripts/routing-validation-report.js
```

---

## الخطوة التالية (ops)

1. اعتماد/إنشاء مزود `gas_central_refill` في Supabase
2. تشغيل Live E2E
3. (اختياري) قرار product على نموذج 1.00/0.90/0.10
