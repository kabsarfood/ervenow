# ERVENOW — متتبع دفعات التنظيف (Second Maturity)

**المرجع:** [SECOND-MATURITY-CLEANUP-MASTER-REPORT.md](./SECOND-MATURITY-CLEANUP-MASTER-REPORT.md)

---

## حالة الدفعات

| الدفعة | الوصف | الحالة | تاريخ | اختبار |
|--------|-------|--------|-------|--------|
| 0 | تحقق (SQL, env, baseline tests) | ⏳ جاهز للتنفيذ | — | — |
| 1 | delivery/assets, preview/, nested package, supabase CLI | ⏸️ بانتظار اعتماد | — | — |
| 2 | customer-preview Phase 2 | ⏸️ | — | — |
| 3 | delivery HTML stubs | ⏸️ | — | — |
| 4 | admin-dashboard monolith, driver.html | ⏸️ | — | — |
| 5 | Database archive | ⏸️ | — | — |
| 6 | Documentation archive | ⏸️ | — | — |

---

## سجل التغييرات

### الدفعة 0

_لا تغييرات بعد._

---

## Baseline اختبارات (29 يونيو 2026)

```
npm test: 74 passed, 2 failed, 1 skipped (77 suites)
  FAIL: cartCheckoutHttpIdempotency.test.js (3 tests)
  FAIL: adminRoleTaxonomy.test.js (1 test)
```

هذه الفشل **موجودة مسبقاً** وليست ناتجة عن التنظيف.
