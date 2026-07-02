# ERVENOW — تقرير مرحلة النضج الثاني (Second Maturity Cleanup)

**التاريخ:** 29 يونيو 2026  
**الحالة:** مراجعة مكتملة — **لم يُنفَّذ حذف بعد**  
**المنهجية:** مراجعة → تقرير → تحقق → تنفيذ آمن → اختبار → اعتماد

---

## ملخص تنفيذي

مراجعة شاملة لمستودع ERVENOW (`ervenow-platform` v2.0.0) كشفت عن:

| المجال | النتيجة الرئيسية |
|--------|------------------|
| **الكود الميت (Frontend)** | أكبر كتلة واضحة: `public/delivery/assets/*` (يتيم بالكامل) + `public/preview/*` (معاينات تصميم) |
| **Legacy** | ازدواجية بوابات (`*-preview` رسمي vs `driver.html` / `store-dashboard`) + `customer-preview` ملغى |
| **Dependencies** | كل إنتاج deps **مستخدمة**؛ مرشّح وحيد: `supabase` CLI (devDep) |
| **Database** | 4 طبقات محفظة متعايشة؛ `delivery_orders` و`service_bookings` legacy بدون JS |
| **Environment** | أسماء قديمة `ERWENOW_*` ما زالت مدعومة للتوافق — يُوحَّد تدريجياً |
| **Performance** | تكرار `public/` ↔ `ervenow-frontend/`؛ HTML monolith قديم؛ 143 ملف SQL |
| **Documentation** | ~75 تقرير markdown + ~370 لقطة شاشة — يحتاج أرشفة |

**خط الأساس للاختبارات:** `npm test` — **74/77 suite ناجح**، فشلان موجودان مسبقاً (غير مرتبطين بالتنظيف):
- `cartCheckoutHttpIdempotency.test.js` (3 اختبارات — توقعات JSON قديمة)
- `adminRoleTaxonomy.test.js` (1 اختبار — تصنيف `gas_cylinder_swap`)

---

## 1. تقرير الأكواد والملفات غير المستخدمة

### 1.1 Frontend — HTML مرشّح للحذف

| الملف | السبب | اعتماديات | أثر الحذف |
|-------|--------|-----------|-----------|
| `public/delivery/assets/*` (12 ملف) | لا HTML يحمّلها؛ stubs فقط في `delivery/*.html` | `docs/responsive-audit-report.md` فقط | **منخفض** |
| `public/delivery/*.html` (4 stubs) | redirects فقط → `/`, `/driver-login`, `/track`, `/driver` | `publicSiteOtpGate` يسمح `/delivery/*` | **منخفض** |
| `public/preview/*` (6 HTML) | معاينات UX؛ لا مسار server ولا روابط إنتاج | `docs/PREVIEW-SECTION-HUB-BRIEF.md` | **منخفض** |
| `public/admin/index.html` | iframe تجريبي | `docs/FOOTER-REMOVAL-AUDIT.md` | **منخفض** |
| `public/customer-preview.html` + `assets/customer-preview.*` | مسار 301 → `start-now`؛ ملغى في Portal Adoption | `portalLaunch.js`, `data/portal-launch.json` | **منخفض–متوسط** |
| `public/admin-dashboard.html` (جذر) | monolith قديم (~5.5k سطر)؛ `/admin-dashboard` يخدم `admin/admin-dashboard.html` | `scripts/split-admin-dashboard.mjs` | **متوسط** |
| `preview-hero-banner.html` (جذر) | معاينة بانر فقط | لا مراجع إنتاج | **منخفض** |

### 1.2 Frontend — HTML نشط لكن legacy (لا تحذف الآن)

| الملف | البديل الرسمي | لماذا يبقى |
|-------|---------------|-----------|
| `driver.html` | `driver-preview.html` | روابط legacy + fallback تشغيلي |
| `store-dashboard.html` | `merchant-preview.html` | post-login merchant + منتجات |
| `merchant-dashboard.html` | `merchant-preview` | طلبات وإيرادات |
| `cart.html` | `checkout.html` | `cart.js` وbadges ما زالت تشير إليه |
| `driver-dashboard.html` | stub → `driver-preview` | `loginDestinations.js` |

### 1.3 Frontend — أصول CSS/JS مرشّحة

| الملف | السبب | أثر الحذف |
|-------|--------|-----------|
| `public/assets/preview-section-hub.js` | يُحمّل فقط من `preview/*` | منخفض (مع preview/) |
| `public/assets/preview-home-hub.css` | نفس ما سبق | منخفض |
| `public/assets/preview-restaurants-hub.css` | نفس ما سبق | منخفض |
| `public/assets/customer-preview.js` | بوابة ملغاة | منخفض–متوسط |
| `ervenow-frontend/assets/portal-framework/portal-framework/**` | نسخة متداخلة ميتة (Phase 2 Portal Adoption) | منخفض |

### 1.4 Backend — مرشّحون

| الملف | السبب | اعتماديات | أثر الحذف |
|-------|--------|-----------|-----------|
| `server/package.json` + `server/package-lock.json` | scaffold قديم؛ `npm start` يستخدم root deps | لا scripts تشير إليه | **منخفض** |
| `apps/finance/wallet-server.js` | HTTP بدون JWT؛ legacy dev tool | `ERVENOW_WALLET_STANDALONE_SERVER=1` | **متوسط** — أمن |
| `apps/test/routes.js` | مسارات اختبار عمولة داخلية | `ERVENOW_ALLOW_COMMISSION_TEST=1` | **منخفض** في prod |

### 1.5 تكرار هيكلي (ليس dead code لكن يضاعف الصيانة)

| الزوج | الحجم التقريبي | الملاحظة |
|-------|----------------|----------|
| `public/` ↔ `ervenow-frontend/` | ~315 vs ~288 ملف | مزامنة عبر `npm run frontend:sync` — **مقصود** لكن يضاعف diff |

---

## 2. تقرير الملفات القديمة (Legacy)

### 2.1 مسارات HTTP legacy (redirects نشطة)

| المسار القديم | التوجيه | الملف القديم ما زال موجوداً؟ |
|---------------|---------|------------------------------|
| `/driver`, `/driver-dashboard` | 301 → `/driver-preview` | نعم (`driver.html`) |
| `/customer-preview` | 301 → `/start-now.html` | نعم |
| `/delivery-request` | 301 → `/delivery-map` | — |
| `/cart` | 302 → `/checkout` | نعم (`cart.html`) |
| `/service-dashboard`, `/provider-dashboard` | 302 → `/services-provider` | — |
| `/restaurant-dashboard` | 302 → `/store-dashboard` | — |

**التوصية:** الإبقاء على redirects 6–12 شهراً بعد حذف الملفات؛ مراقبة logs للوصول المباشر.

### 2.2 مجلد `public/delivery/` — تطبيق مصغّر قديم

- علامة تجارية قديمة («arwenow») في الأصول
- 4 صفحات stub + 12 أصل يتيم
- **لا `app.get` مخصص** — `express.static` فقط

### 2.3 Portal Framework vs اللوحات الكلاسيكية

**الرسمي (Portal 2.0):** `merchant-preview`, `driver-preview`, `service-preview`, `transport-preview`  
**خارج Framework:** العميل (`start-now`)، الإدارة (`admin/admin-dashboard.html`)

مرجع: `docs/PORTAL-ARCHITECTURE-ADOPTION.md` — Phase 2 لم تُنفَّذ بعد (حذف customer-preview).

### 2.4 Database legacy

| الكيان | الحالة | مرجع |
|--------|--------|------|
| `delivery_orders` | لا JS references | `docs/legacy-inventory.md` |
| `service_bookings` | مُستبدَل بـ `orders` | migrations unification 11–13 |
| `food_orders` | **نشط** — ليس legacy | `apps/food/routes.js` |
| 4 طبقات محفظة | متعايشة؛ ledger = هدف | `docs/wallet-system.md` |

### 2.5 Migrations SQL مُستبدَلة (أرشفة فقط — لا حذف)

| ملف | يُستبدَل بـ |
|-----|------------|
| `migration_unification_11_service_bookings_to_orders.sql` | `migration_unification_11_smart_*` |
| `migration_ervenow_withdraw_requests_schema_cache.sql` | `migration_withdraw_ledger_only_final.sql` |

---

## 3. تقرير المكتبات غير المستخدمة (Dependencies)

### 3.1 Production dependencies (16/16 مستخدمة)

| الحزمة | الاستخدام | خطر الحذف |
|--------|-----------|-----------|
| `@supabase/supabase-js` | `shared/config/supabase.js` + 36+ ملف | عالٍ جداً |
| `bullmq` + `ioredis` | طوابير + cache (مكمّلان لا مكرّران) | عالٍ |
| `express`, `cors`, `morgan`, `dotenv` | الخادم | عالٍ |
| `express-rate-limit` | checkout/delivery/order | عالٍ |
| `jsonwebtoken` | auth + sockets | عالٍ |
| `pino`, `prom-client`, `opossum` | logging, metrics, circuit breaker | عالٍ |
| `pdfkit`, `qrcode` | فواتير | عالٍ |
| `socket.io` | تتبع حي | عالٍ |
| `twilio` | WhatsApp/OTP | عالٍ |

### 3.2 DevDependencies

| الحزمة | الحالة | توصية |
|--------|--------|-------|
| `jest` | 77 ملف اختبار | إبقاء |
| `@playwright/test` | e2e + 14 script capture | إبقاء |
| `artillery` | `npm run load:test` | إبقاء |
| `pg` | 31 script migration | إبقاء؛ أو نقل لـ dependencies إن تُشغَّل migrations على Railway |
| **`supabase` CLI** | **لا استخدام في الكود أو scripts** | **مرشّح للإزالة** (خطر منخفض) |

### 3.3 nested `server/package.json`

- `http-proxy-middleware` — **صفر مراجع** في الكود
- `express`/`morgan` — مكررة من root
- **توصية:** حذف الملفين أو توثيق أن root `package.json` هو المصدر الوحيد

### 3.4 تحديثات مقترحة (مراجعة فقط — لا تنفيذ)

| الحزمة | الإصدار الحالي | ملاحظة |
|--------|----------------|--------|
| `express` | ^4.21.2 | Express 5 متاح — تأجيل لما بعد التنظيف |
| `dotenv` | ^16.4.5 | v17 متاح |
| `@supabase/supabase-js` | ^2.49.1 | تحديث دوري آمن بعد اختبار |

---

## 4. تقرير قاعدة البيانات

### 4.1 جداول بدون `.from()` في JS

| الجدول | الحالة | خطر الحذف |
|--------|--------|-----------|
| `delivery_orders` | Legacy | عالٍ — تحقق BI/فواتير |
| `service_bookings` | Legacy | عالٍ |
| `service_bookings_legacy` | أرشيف | متوسط |
| `ervenow_migration_skipped_rows` | artifact هجرة | منخفض–متوسط |
| `settlement_log` | RPC فقط (`settlementGuard.js`) | عالٍ — **لا تحذف** |
| `store_wallets` | RPC فقط | عالٍ |

### 4.2 طبقات المحفظة

```
هدف (ledger_only): ervenow_ledger_wallets + ervenow_ledger_transactions + ervenow_withdraw_requests
legacy MVP:          wallets + wallet_transactions + withdrawals
operational:         ervenow_wallets + ervenow_wallet_transactions
driver COD:          driver_wallets + driver_ledger
store internal:      store_wallets (RPC) + store_withdrawals (JS)
```

**لا حذف جداول مالية** قبل `FINANCE_MODE=ledger_only` + مطابقة أرصدة.

### 4.3 SQL للتحقق قبل أي حذف

```sql
SELECT 'delivery_orders' t, count(*) FROM delivery_orders
UNION ALL SELECT 'service_bookings', count(*) FROM service_bookings
UNION ALL SELECT 'wallets', count(*) FROM wallets
UNION ALL SELECT 'ervenow_ledger_wallets', count(*) FROM ervenow_ledger_wallets;

SELECT table_type FROM information_schema.tables
WHERE table_schema='public' AND table_name='withdraw_requests';
```

---

## 5. مراجعة Environment Variables

### 5.1 متغيرات نشطة (من `.env.example` + الكود)

| المتغير | الاستخدام |
|---------|-----------|
| `ERVENOW_JWT_SECRET` | auth (مع fallback `ERWENOW_JWT_SECRET`) |
| `BANK_DATA_SECRET` | تشفير IBAN |
| `FINANCE_MODE` | `ledger_only` = مسار مالي وحيد |
| `INTERNAL_API_KEY` | كبسار + delivery internal |
| `ERVENOW_PUBLIC_URL` | روابط WhatsApp + CORS |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | DB |
| `REDIS_URL` | BullMQ + cache |
| `TWILIO_*` | OTP/WhatsApp |
| `FINANCE_MODE`, `PAYMENT_GATEWAY`, `MOYASAR_*` | دفع |
| `DELIVERY_ENGINE_*` | محرك توصيل 1.0 |
| `SERVE_STATIC`, `HIDE_PUBLIC_UI` | نشر static |
| `CORS_ORIGINS`, `METRICS_ENABLED` | إنتاج |
| `ERVENOW_ADMIN_*_PHONES` | صلاحيات أدمن |

### 5.2 أسماء قديمة للتوحيد (لا حذف فوري)

| قديم | جديد | الملفات المتأثرة |
|------|------|------------------|
| `ERWENOW_JWT_SECRET` | `ERVENOW_JWT_SECRET` | `auth.js`, `otpChallengeService.js` |
| `ERWENOW_PUBLIC_URL` | `ERVENOW_PUBLIC_URL` | `admin/routes.js`, `storeWhatsApp.js` |
| `ERWENOW_ADMIN_WHATSAPP` | `ERVENOW_ADMIN_WHATSAPP` | `store/routes.js` |
| `ERWENOW_STORE_FILES_BUCKET` | `ERVENOW_STORE_FILES_BUCKET` | `storeFileUpload.js` |
| `ERWENOW_PLATFORM_*_RATE` | `ERVENOW_PLATFORM_*_RATE` | finance hooks |

**توصية:** توحيد في Railway/Vercel/Supabase Secrets تدريجياً؛ الإبقاء على fallback في الكود حتى اكتمال الهجرة.

### 5.3 متغيرات للمراجعة في الإنتاج

| المتغير | السؤال |
|---------|--------|
| `ERVENOW_WALLET_STANDALONE_SERVER` | هل مُفعَّل؟ يجب أن يكون `0`/غير معرّف |
| `ALLOW_DEV_OTP` | يجب أن يكون معطّلاً في prod |
| `ERVENOW_ALLOW_COMMISSION_TEST` | يجب أن يكون معطّلاً في prod |
| `SUPABASE_ANON_KEY` | هل مستخدم فعلاً؟ (الخادم يستخدم service role) |

---

## 6. تقرير تحسينات الأداء المقترحة

### 6.1 Frontend

| التحسين | التأثير المتوقع | المخاطر |
|---------|-----------------|---------|
| حذف `delivery/assets` + `preview/*` | تقليل ~30–50 KB + تبسيط | منخفضة |
| إزالة `admin-dashboard.html` الجذر بعد اكتمال split | تقليل confusion + حجم repo | متوسطة |
| `defer`/`async` موحّد لـ scripts غير حرجة في HTML الكبيرة | تحسين TTI | اختبار شامل |
| مراجعة تحميل portal-framework (16 ملف) — bundle حسب الدور | تحسين LCP على البوابات | متوسطة |
| ضغط صور `public/assets/icons/` وbranding | تقليل payload | منخفضة |

### 6.2 Backend

| التحسين | التأثير | الملاحظة |
|---------|---------|----------|
| Redis cache لـ `platform_settings` وfeature flags | تقليل round-trips Supabase | `redisCache.js` موجود |
| تقليل `select("*")` في routes — أعمدة محددة | استعلامات أخف | تدريجي |
| Circuit breaker OSRM (`opossum`) — مراجعة timeouts | استقرار تحت الحمل | موجود |
| Rate limits قابلة للضبط عبر env | حماية + أداء | موجود |

### 6.3 Database

| التحسين | الشرط |
|---------|-------|
| أرشفة `delivery_orders` بعد التحقق | count = 0 أو migrated |
| إكمال `ledger_only` وإيقاف writes للطبقات القديمة | مطابقة مالية |
| indexes على `orders(status, created_at)` — مراجعة EXPLAIN | بعد تحليل slow queries |

### 6.4 DevOps / Build

| التحسين | التأثير |
|---------|---------|
| `frontend:sync` فقط عند deploy — لا commit مزدوج يدوي | تقليل drift |
| `.gitignore` لـ `test-results/`, `.redis-local/` | repo أنظف |
| CI: `npm test` + smoke e2e على كل PR cleanup | أمان |

---

## 7. تنظيف الوثائق

### 7.1 وثائق مرجعية — **إبقاء**

| الملف | السبب |
|-------|-------|
| `architecture.md`, `database-flow.md`, `deployment.md` | مرجع تشغيلي |
| `SOURCE-OF-TRUTH.md`, `order-lifecycle.md`, `wallet-system.md` | SoT |
| `legacy-inventory.md`, `STABILIZATION-PLAN.md` | تنظيف |
| `PORTAL-ARCHITECTURE-ADOPTION.md` | بوابات |
| `production-readiness-checklist.md` | إطلاق |

### 7.2 تقارير مرحلة مكتملة — **أرشفة** (نقل لـ `docs/archive/`)

| الفئة | أمثلة | العدد التقريبي |
|-------|-------|----------------|
| Typography PR1–PR4 | `TYPOGRAPHY-PR*-REPORT.md` | 5 |
| Mobile Excellence | `MOBILE-EXCELLENCE-*` | 10+ |
| Checkout Engine | `CHECKOUT-ENGINE-PHASE*-REPORT.md` | 5 |
| Portal sprints | `PORTAL-COMPLETION-SPRINT.md`, audits | 8+ |
| LPG/Gas audits | `LPG-*`, `ERVENOW-LPG-*` | 6+ |

### 7.3 لقطات شاشة — **أرشفة أو ضغط**

- `docs/screenshots/` (~348 PNG)
- `docs/validation-screenshots/`, `docs/review-screenshots/`

**توصية:** نقل لـ `docs/archive/screenshots/` أو git LFS؛ الإبقاء على README يشرح المحتوى.

### 7.4 تكرار

- `docs/تنفيذ_هجرة_المالية.md` — يظهر مرتين في git (path separator) — توحيد مسار واحد

---

## 8. خطة التنفيذ على دفعات

### الدفعة 0 — تحقق (قبل أي حذف)

- [ ] تشغيل SQL row counts على Supabase production
- [ ] مراجعة Railway env vars (قائمة 5.3)
- [ ] `npm test` baseline (حالياً 2 suite فاشل — توثيق فقط)
- [ ] `npm run test:e2e` smoke

### الدفعة 1 — آمنة (أثر منخفض)

| الإجراء | الملفات |
|---------|---------|
| حذف أصول يتيمة | `public/delivery/assets/*` |
| حذف معاينات | `public/preview/*` + CSS/JS المرتبطة |
| حذف | `preview-hero-banner.html`, `public/admin/index.html` |
| حذف nested package | `server/package.json`, `server/package-lock.json` |
| إزالة devDep | `supabase` CLI |
| مزامنة | `npm run frontend:sync` |

**اختبار بعد الدفعة 1:** smoke e2e + فتح `/`, `/merchant-preview`, `/driver-preview`

### الدفعة 2 — Portal Phase 2

| الإجراء | الملفات |
|---------|---------|
| حذف customer-preview | `public/customer-preview.html`, `assets/customer-preview.*` |
| حذف configs مكررة | `ervenow-frontend/.../customer.json`, `admin.json`, nested portal-framework |
| الإبقاء على redirect 301 | `/customer-preview` في server |

### الدفعة 3 — Legacy stubs

| الإجراء | الملفات |
|---------|---------|
| حذف stubs | `public/delivery/*.html` (بعد التأكد من عدم روابط خارجية) |
| توثيق redirects | server يبقى كما هو |

### الدفعة 4 — Monoliths (بعد تحقق)

| الإجراء | الشرط |
|---------|-------|
| حذف `admin-dashboard.html` الجذر | اكتمال split + لا مراجع scripts |
| تقييم `driver.html` | بعد نقل كل الوظائف لـ driver-preview |

### الدفعة 5 — Database (بعد مطابقة مالية)

- أرشفة `delivery_orders` (لا DROP)
- إكمال ledger migration
- توحيد withdraw VIEW

### الدفعة 6 — Documentation

- إنشاء `docs/archive/`
- نقل تقارير المراحل المكتملة
- تحديث `docs/README.md`

---

## 9. قائمة تحقق الاختبار الشامل

بعد كل دفعة:

```
[ ] npm test
[ ] npm run test:e2e (smoke + core-validation)
[ ] GET /api/health/full
[ ] فتح يدوي: /start-now, /checkout, /wallet, /admin-dashboard
[ ] بوابات: merchant-preview, driver-preview, service-preview, transport-preview
[ ] redirects: /driver → driver-preview, /customer-preview → start-now
[ ] جوال: 320px, 390px, 768px, 1280px (mobile-preview.html)
```

---

## 10. التقرير النهائي (يُملأ بعد التنفيذ)

| البند | الحالة |
|-------|--------|
| ما تم حذفه | _يُحدَّث بعد كل دفعة_ |
| ما تم تحسينه | _يُحدَّث_ |
| أثر الأداء | _قياس قبل/بعد حجم repo وTTI_ |
| تأكيد الوظائف | _نتائج الاختبار_ |

---

## المراجع

- `docs/legacy-inventory.md`
- `docs/PORTAL-ARCHITECTURE-ADOPTION.md`
- `docs/wallet-system.md`
- `docs/database-refactor-migrations.md`
- `docs/STABILIZATION-PLAN.md`
- `data/portal-launch.json`

---

*هذا التقرير هو المخرج الأول لمرحلة النضج الثاني. التنفيذ يبدأ بالدفعة 0 ثم الدفعة 1 بعد اعتماد صريح.*
