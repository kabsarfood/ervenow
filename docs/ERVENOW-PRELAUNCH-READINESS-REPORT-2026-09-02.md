# ERVENOW — PRELAUNCH READINESS REPORT

**Date:** 2026-09-02  
**Baseline:** Closed Alpha **C** (`docs/ERVENOW-CLOSED-ALPHA-GATE-2026-09-01.md`)  
**Scope:** Production OTP storage + Pre-Registration Mode + Launch Readiness counter  
**Not granted:** Soft Launch · Public marketplace · Commercial ordering for the public

---

## Executive Summary

المنصة أصبحت جاهزة **تقنياً** لاستقبال تسجيل مسبق مغلق الطلبات: OTP في Postgres (hashed، restart-safe)، Kill Switch خلفي، عدّاد إطلاق في الأدمن، ومنع فتح الطلبات تلقائياً حتى عند 100%.

حملة تسجيل **واسعة** (Google Ads / أرقام جديدة) ما زالت غير آمنة لأن Twilio WhatsApp ما زال **Sandbox** (`status: sandbox`, خطأ `63015` للأرقام غير المنضمّة). بدون رقم إنتاج، معظم العملاء الجدد لن يستلموا OTP.

هذه المرحلة **لا تفتح** الطلبات التجارية ولا Soft Launch.

### Production Registration Readiness

# **A — NOT READY FOR REGISTRATION CAMPAIGN**

السبب الوحيد الحاسم: **توصيل OTP عبر واتساب ما زال Sandbox.** باقي عمل Pre-Registration (تخزين OTP، القفل، العداد، الحماية) مكتمل.

بعد ترقية Twilio إلى sender إنتاج (ليس `+14155238886`) وإعادة فحص `GET /api/health/full` → `twilio: configured`، يمكن إعادة القرار إلى **B** دون إعادة بناء هذه المرحلة.

---

## OTP Architecture

### قبل (Closed Alpha 2026-09-01)

- الافتراضي التشغيلي: **process memory**
- إعادة تشغيل الخادم تفقد الرموز النشطة
- أكثر من Instance لا يرى نفس الحالة
- جدول `ervenow_otp_challenges` كان موجوداً لكن غير مفعّل كمسار افتراضي

### بعد (2026-09-02)

- الافتراضي: **`ERVENOW_OTP_BACKEND=supabase`** (PostgreSQL عبر service role)
- الرمز يُخزَّن **hashed** (`code_hash`) — لا plaintext
- الحقول: `subject_key`, `code_hash`, `expires_at`, `attempts`, `max_attempts`, `consumed_at`, `last_sent_at`, `locked_until`, `ip`, `created_at`
- نجاح verify يضع `consumed_at` — إعادة الاستخدام تفشل
- صلاحية محددة، حد محاولات (5)، cooldown إعادة إرسال، حد IP لكل 10 دقائق
- `memory` مرفوض في `NODE_ENV=production` إلا مع `ERVENOW_OTP_ALLOW_MEMORY=1`
- Jest يستخدم memory عمداً عبر `tests/jest.otp-memory.env.js`

---

## Redis

| بند | الحالة |
|-----|--------|
| مطلوب لـ OTP؟ | **لا** |
| الاستخدام | طابور التوصيل (BullMQ) اختياري، كاش، مستقبل Socket.IO adapter |
| الاتصال | `connectTimeout` 2s، `commandTimeout` 3s، `enableOfflineQueue: false`، `lazyConnect`، retry محدود |
| فشل Redis | لا يعلّق Express؛ الطابور يسقط inline؛ `/api/health/full` يبقى 200 إذا DB سليمة و`redis: fail` أو `skipped` |
| Fallback | بدون `REDIS_URL` → `skipped` / optional |

`REDIS_URL` معيّن في البيئة الحالية لكن الاتصال التاريخي لـ Closed Alpha كان `ECONNREFUSED` على `127.0.0.1:6379`. هذا لا يمنع Pre-Registration لأن OTP لا يعتمد عليه.

---

## Twilio

| بند | الحالة |
|-----|--------|
| Credentials | موجودة server-side فقط (`configured: true`) |
| Sender | Sandbox (`from_last4=8886`) |
| Health | `twilio: sandbox` |
| 63015 | يُترجم لرسالة عربية واضحة للعميل — لا أسرار في السجلات التشغيلية |
| Webhook signature | موجودة مسبقاً (`shared/utils/twilioWebhookAuth.js`) |
| `TWILIO_WEBHOOK_URL` | غير معيّن (لا يظهر في الحالة) |
| Boot | يحذّر إذا كان المرسل Sandbox |

**لا يكفي لحملة أرقام عامة.** الأرقام غير المنضمّة للـ Sandbox لن تستلم OTP.

---

## Socket.IO

| الإطلاق الحالي | Instance واحد — adapter = memory |
|---|---|
| `SOCKET_IO_SINGLE_INSTANCE_REQUIRED` | `true` (افتراضي + أُضيف للبيئة) |
| Redis adapter | **غير منفَّذ** في هذه المرحلة (مخاطر غير ضرورية لإطلاق محدود) |
| تحجيم لاحق | وثّق: لا تشغّل أكثر من process لـ Socket.IO بدون adapter |

---

## Pre-Registration Mode

الزائر يستطيع:

- تصفح الصفحات العامة
- إنشاء حساب + OTP
- تسجيل اهتمام / انضمام مندوب / تاجر / سطحة / غاز / خدمة

العميل **لا** يستطيع (Backend):

- إنشاء طلب تجاري حي
- الدفع لمحفظة طلب (`/api/wallet/ledger/pay`)
- استدعاء مندوب فعلي عبر مسارات الإنشاء

`GET /api/core/public-config` يعيد `public_ordering_enabled` و`pre_registration`.

بعد verify OTP للعميل والطلبات مغلقة: رسالة

> تم تسجيلك بنجاح ضمن المستخدمين الأوائل في ERVENOW. سنبلغك عند بدء الخدمة.

والتحويل إلى `/pre-registered.html`.

شريط عام في `guest-shell` يظهر عندما `pre_registration === true`. الحظر **ليس** إخفاء زر فقط.

---

## Public Ordering Kill Switch

**SoT**

1. `PUBLIC_ORDERING_ENABLED=false|0|off` → مغلق دائماً (يتفوق على ملف الأدمن) — **هذا وضع الإطلاق الأول الحالي**
2. `=true` → قفل مفتوح من البيئة
3. غير معيّن → `data/public-ordering.json` (افتراضي false)

عند الإغلاق، مسارات الإنشاء تعيد **403**:

```json
{ "ok": false, "error": "التسجيل مفتوح — الطلبات التجارية لم تُطلق بعد. سنبلغك عند بدء الخدمة.", "reason": "SERVICE_NOT_LAUNCHED", "public_ordering": false }
```

مغطى على: `/api/order/create`, `/api/checkout`, `/api/delivery/create`, `/api/delivery/orders`, services home/gas/bookings/checkout, `/api/wallet/ledger/pay`, ومسارات legacy `/api/food/orders` و`/api/finance/orders`.

استثناء داخلي موثوق: **`role === admin` فقط** (`isInternalOrderingAllowed`). لا bypass من الواجهة.

**لا فتح تلقائي** عند اكتمال العداد (`auto_launch: false` في كل الاستجابات).

---

## Launch Targets

ثوابت في `shared/config/launchTargets.js` (تجاوز عبر `LAUNCH_TARGET_*` من البيئة فقط — ليست API عامة):

| الفئة | Target المعتمد |
|--------|----------------|
| عملاء موثّقو OTP | **200** |
| مناديب مسجّلون | **27** (وسط 25–30) |
| مناديب جاهزون (`drivers.status=approved` و`active=true`) | **13** (وسط 12–15) |
| مطاعم جاهزة (`stores.type=restaurant` و`status=approved`) | **9** (وسط 8–10) |
| سوبرماركت جاهز | **2** |
| صيدليات جاهزة | **2** (سقف 1–2) |
| سطحات جاهزة | **5** (وسط 4–5) |
| غاز جاهز | **3** (وسط 2–3) |

الجاهزية تستخدم الحالات **الموجودة** (`pending` / `approved` / `active`). التسجيل الذاتي للمندوب يبقى `pending` + `active=false`. لا نظام حالات موازٍ. لا يُحسب Ready لمجرد إنشاء حساب.

---

## Launch Counter

أوزان (المجموع 1.0) — كل فئة مسقوفة عند Target (لا 300%):

| الفئة | الوزن |
|--------|--------|
| عملاء موثّقون | 30% |
| مناديب مسجّلون | 8% |
| مناديب جاهزون | 12% |
| مطاعم | 15% |
| سوبرماركت | 10% |
| صيدليات | 5% |
| سطحات | 10% |
| غاز | 5% |
| جاهزية تقنية (OTP supabase + Twilio + Redis + Socket) | 5% |

التقنية: OTP supabase 40% من هذا الصندوق؛ Twilio إنتاج 35% (Sandbox = 0.4 من صندوق Twilio)؛ Redis 15%؛ Socket single-instance 10%.

النطاق:

| النسبة | الحالة |
|--------|--------|
| &lt; 60% | `NOT_READY` |
| 60–79% | `BUILDING_SUPPLY` |
| 80–99% | `READY_FOR_LIMITED_LAUNCH` |
| 100% | `TARGET_ACHIEVED` |

حتى `TARGET_ACHIEVED` **لا** يفتح `PUBLIC_ORDERING_ENABLED`.

---

## Admin Dashboard

قسم **إطلاق المنصة / Launch Readiness**:

- النسبة والحالة
- Target مقابل العدد (مسجّل vs جاهز)
- تسجيلات اليوم وآخر 7 أيام
- Trend 7 أيام: تاريخ / عملاء / مناديب / تجار-مزودون
- Kill Switch مع تأكيد `ENABLE_PUBLIC_ORDERING` / `DISABLE_PUBLIC_ORDERING`
- إذا البيئة `PUBLIC_ORDERING_ENABLED=false` → الفتح من اللوحة يُرفض 409 `ENV_KILL_SWITCH`

مسارات أدمن (JWT + `requireRole("admin")`):

- `GET /api/admin/launch-readiness`
- `GET /api/admin/launch-trend`
- `GET|POST /api/admin/public-ordering`
- `GET /api/admin/ops-health`

---

## Campaign Attribution

عند `verify-otp` تُحفظ اختيارياً على `users` (ليست Required):

`city`, `district`, `acquisition_source`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `gclid`, `phone_verified_at`

الواجهة (`login.html`) تمرّر query params هذه مع التحقق.

---

## Security

- العميل لا يستطيع جعل نفسه `ready` / `approved` / `active` للمندوب أو المتجر
- موافقات `approved` من مسارات الأدمن فقط (ما عدا مسار تطوير OTP للمندوب وهو Dev-only)
- الإعدادات العامة `POST /api/admin/settings/update` ترفض مفاتيح `public_ordering_enabled` و`public_ordering` و`launch_targets`
- تبديل الطلبات: أدمن + عبارة تأكيد + audit (`insertAuditEvent`)
- لا يعتمد Kill Switch على حالة الواجهة

**اختيار التحكم بالإطلاق الأول:** متغير البيئة `PUBLIC_ORDERING_ENABLED=false` أقوى من ملف الأدمن لأنه لا يُفتح من اللوحة بالخطأ. الملف يبقى للتبديل اليدوي **بعد** إزالة قفل البيئة بقرار تشغيلي منفصل.

---

## Tests

تشغيل `npx jest --ci` في 2026-09-02:

| | |
|--|--|
| Passed | **411** |
| Failed | **0** |
| Skipped | **1** |

السابق: 388 / 0 / 1. لا regression.

يغطي الجديد: OTP صالح/خاطئ/منتهي/إعادة استخدام/حد محاولات/cooldown/تخزين مشترك (محاكاة restart)/verify مزدوج؛ Kill Switch للعميل؛ استثناء الأدمن؛ سقف النسبة والنطاقات؛ منع مفتاح الإطلاق من settings العامة؛ عقود المصدر (أدمن-only، food/finance gated، تسجيل مندوب pending).

Jest يضبط `PUBLIC_ORDERING_ENABLED=true` حتى لا تكسر اختبارات الطلبات الحالية.

---

## Files Changed

أساسي لهذه المرحلة (وليس كل ملفات العمل غير المرتبطة):

**Backend:** `shared/services/otpChallengeService.js`, `shared/utils/publicOrdering.js`, `shared/middleware/publicOrderingGate.js`, `shared/config/launchTargets.js`, `shared/services/launchReadiness.js`, `shared/utils/twilioRuntime.js`, `shared/utils/socketRuntime.js`, `shared/middleware/apiRateLimits.js`, `queues/deliveryQueue.js`, `server/server.js`, `apps/core/routes.js`, `apps/admin/routes.js`, `apps/admin/settings.js`, `apps/order/routes.js`, `apps/checkout/routes.js`, `apps/delivery/routes.js`, `apps/services/routes.js`, `apps/wallet/routes.js`, `apps/food/routes.js`, `apps/finance/routes.js`, `apps/driver/routes.js`

**Frontend (`public/` ثم `npm run frontend:sync` → `ervenow-frontend/`):** `admin/admin-dashboard.html|js`, `admin/modules/launch-readiness.js`, `bootstrap.js`, `shared.js`, `assets/api.js`, `cart.js`, `checkout-engine.js`, `guest-shell.js|css`, `login.html`, `pre-registered.html`

**Tests:** `tests/jest.otp-memory.env.js`, `tests/unit/otpChallengeShared.test.js`, `tests/unit/prelaunchPublicOrdering.test.js`, `tests/helpers/otpFakeSb.js`, `tests/unit/p0AdminSettingsAuth.test.js`

**Docs / data / scripts:** `.env.example`, `docs/architecture.md`, `docs/deployment.md`, `data/public-ordering.json`, `scripts/run-migration-prelaunch-2026-09-02.js`

---

## Database Migrations

طُبّقت على قاعدة الاختبار عبر `node scripts/run-migration-prelaunch-2026-09-02.js`:

1. `shared/migration_ervenow_otp_challenges.sql` — جدول OTP + RLS
2. `shared/migration_prelaunch_otp_consumed.sql` — `consumed_at` + فهرس IP
3. `shared/migration_prelaunch_user_attribution.sql` — `city`, `district`, `phone_verified_at`, UTM, `gclid`

---

## Environment Variables

بدون أسرار:

| المتغير | القيمة المعتمدة لهذه المرحلة |
|----------|-------------------------------|
| `ERVENOW_OTP_BACKEND` | `supabase` |
| `ERVENOW_OTP_ALLOW_MEMORY` | غير مسموح في الإنتاج |
| `ERVENOW_OTP_PEPPER` | مفضّل 32+ (أو اشتقاق من JWT مع تحذير) |
| `ERVENOW_OTP_MAX_ATTEMPTS` | 5 |
| `ERVENOW_OTP_RESEND_COOLDOWN_MS` | 45000 |
| `ERVENOW_OTP_IP_MAX_PER_10MIN` | 10 |
| `PUBLIC_ORDERING_ENABLED` | `false` (قفل بيئة) |
| `SOCKET_IO_SINGLE_INSTANCE_REQUIRED` | `true` |
| `LAUNCH_TARGET_*` | اختياري لتجاوز الأهداف |
| `REDIS_URL` | اختياري (طابور فقط) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_NUMBER` | مطلوبة — يجب أن تكون إنتاج وليست Sandbox قبل الحملة |

---

## Remaining Risks

1. **Twilio Sandbox (حاسم للحملة)** — OTP لن يصل لأرقام غير منضمّة؛ خطأ 63015.
2. Redis غير مستقر محلياً — لا يكسر OTP؛ يؤثر على الطابور والكاش فقط.
3. Socket.IO memory adapter — تشغيل أكثر من process يكسر الغرف الحية.
4. عمود `phone_verified_at` إن فُقد على بيئة أخرى يُحتسب العملاء كمسجّلين لا موثّقين حتى تُعاد الهجرة.
5. جدول audit قد يكون غائباً — تبديل الطلبات يُحفظ في الملف حتى لو فشل الـ audit.
6. `TWILIO_WEBHOOK_URL` غير معيّن — لا يؤثر على إرسال OTP، يؤثر على inbound webhook إن لزم.

---

## Production Registration Readiness

# **A — NOT READY FOR REGISTRATION CAMPAIGN**

**ما اكتمل:** تخزين OTP المركزي الآمن، Kill Switch خلفي، وضع Pre-Registration، عدّاد الإطلاق، حماية الأدمن، 411 اختباراً بدون فشل.

**ما يمنع الحملة الآن:** WhatsApp Twilio ما زال Sandbox. لا تشغّل إعلانات اكتساب واسعة حتى يصبح `GET /api/health/full` يعرض `twilio: configured` (ليس `sandbox`) وتجربة OTP على رقم جديد غير منضمّ للـ Sandbox تنجح.

**ما لا يُمنح بهذه المرحلة:** Soft Launch · Public Ordering · أموال عملاء حقيقية.
