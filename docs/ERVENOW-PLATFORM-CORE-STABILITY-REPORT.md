# ERVENOW Platform Core Stability Report

**Sprint:** G1-R Final Verification  
**التاريخ:** 20 يونيو 2026  
**الحكم الإجمالي:** **NOT STABLE — لا انتقال إلى Phase 2**

> معيار هذا التقرير: **PASS أو FAIL فقط**.

---

## ملخص تنفيذي

| البند | النتيجة |
|-------|---------|
| Merchant | **PASS** |
| Driver | **PASS** |
| Service | **FAIL** |
| Transport | **PASS** |
| Wallet | **PASS** |
| Notifications | **PASS** |
| Routing | **PASS** |
| Database | **PASS** |
| Redis | **FAIL** |
| E2E | **PASS** |

**PASS: 8/10 · FAIL: 2/10**

---

## 1. Database Closure — **PASS**

```json
{ "consistent": true }
```

| فحص | النتيجة |
|-----|---------|
| Schema Consistency | 62/62 عموداً متوقعاً |
| Missing Columns | **0** |
| Failed Constraints | **0** |
| Failed Indexes | **0** |

**Migrations مُطبَّقة:**
- `migration_orders_schema_closure_g1r.sql`
- `migration_orders_portal_type.sql` (portal_type يشمل `driver`)
- `migration_notifications.sql`

**تقارير:** `data/database-closure-report.json` · `data/orders-schema-consistency-report.json`

---

## 2. Live E2E — Merchant → Driver — **PASS**

**سكربت:** `LIVE_E2E=1 node scripts/reconnect-lifecycle-live-e2e.js`  
**تقرير:** `data/reconnect-lifecycle-live-e2e.json`

| المرحلة | الحالة | البوابة |
|---------|--------|---------|
| إنشاء طلب | pending | Merchant |
| Accept | accepted | Merchant |
| Preparing | preparing | Merchant |
| Ready | ready | Merchant |
| Driver Accept | picked_up | Driver |
| Delivering | delivering | Driver |
| Delivered | delivered | Driver |

**إثبات:**
- Settlement: `ok: true` · driver +12 ر.س
- Wallet: 465.38 → 477.38 (+12)
- Notifications: **12** حدثاً (بعد migration_notifications)

---

## 3. Gas Validation (Service Portal) — **FAIL**

**تقرير:** `data/g1r-live-service-verify.json`

| المرحلة | النتيجة |
|---------|---------|
| إنشاء طلب غاز | **PASS** — `portal_type: service` |
| ظهور في Service Portal | **PASS** — `visible_service: true` |
| عدم الظهور في Transport | **PASS** — `visible_transport: false` |
| قبول المهمة | **FAIL** — لا يوجد `role=service` في DB |
| تنفيذ / إغلاق / تسوية | **FAIL** — لم يُختبر (لا مزوّد) |

**Blocker:** `service_users: []` في Supabase.

---

## 4. Internal Delivery (Driver Portal) — **PASS**

**تقرير:** `data/g1r-live-service-verify.json`

| المرحلة | النتيجة |
|---------|---------|
| إنشاء طلب | **PASS** — `portal_type: driver` |
| ظهور في Driver Portal | **PASS** |
| accepted → delivering → delivered | **PASS** |
| driver_id مُسند | **PASS** |

**مسار مُثبت:** `new → accepted → delivering → delivered` (Driver)

---

## 5. Merchant Completion Audit — **PASS**

| العنصر | النتيجة |
|--------|---------|
| Product Images | **PASS** — `mpPImage` + `image_base64` |
| Product Stock | **PASS** — `mpPStock` + API `stock` |
| Reviews | **PASS** — `/api/store/reviews` |
| Visitor Preview | **PASS** — `renderVisitorPreview()` + `/store.html?preview=1` |

---

## 6. Driver Completion Audit — **PASS**

| العنصر | النتيجة |
|--------|---------|
| Google Maps | **PASS** — `openGoogleMapsDir` |
| Apple Maps | **PASS** — `openAppleMapsDir` |
| Waze | **PASS** — `openWazeDir` |
| Proximity Alerts | **PASS** — `checkProximityAuto` @ 120m |
| TTS | **PASS** — `speakArabic` |

---

## 7. Routing — **PASS**

**تقرير:** `data/routing-validation-report.json` · Status: **PASS**

- Order routing: 14/14
- Provider routing: 7/7
- Transport exclusions (غاز + توصيل داخلي): 4/4

---

## 8. Notifications — **PASS**

- جدول `public.notifications` **موجود** (بعد `run-migration-notifications.js`)
- Live E2E: **12** إشعاراً مُسجَّلاً

---

## 9. Wallet — **PASS**

- Live E2E: credit المندوب +12 ر.س بعد `delivered`
- Settlement RPC: `settled_via_rpc`

---

## 10. Redis — **FAIL**

**تقرير:** `data/redis-closure-audit.json`

- `REDIS_URL` → `127.0.0.1:6379` — **ECONNREFUSED**
- Queue / DLQ / stalled jobs: غير قابل للفحص

**الإجراء:** Redis production URL + `npm run worker:delivery`

---

## قرار المرحلة

| الشرط | الحالة |
|-------|--------|
| جميع البنود PASS | **لا** — Service + Redis = FAIL |
| **ERVENOW Platform Core Stable v2.0** | **❌ غير مُعلَن** |
| **Phase 2 — ERVENOW POS Core** | **⏸ مؤجّل** |

### Blockers (ترتيب الإغلاق)

1. **Service:** إنشاء حساب مزوّد غاز (`role=service`, `service_type=gas_cylinder_swap`) → إعادة اختبار Gas Validation.
2. **Redis:** Redis cloud URL فعّال + worker → `node scripts/redis-closure-audit.js` → PASS متوقع.

---

## مراجع

| التقرير | المسار |
|---------|--------|
| Database Closure | `data/database-closure-report.json` |
| Orders Schema | `docs/ORDERS-SCHEMA-CONSISTENCY-REPORT.md` |
| Routing Validation | `docs/ROUTING-VALIDATION-REPORT.md` |
| Live E2E | `docs/RECONNECT-LIFECYCLE-LIVE-E2E.md` |
| Gas + Internal | `data/g1r-live-service-verify.json` |
| Redis Audit | `docs/REDIS-CLOSURE-AUDIT.md` |
