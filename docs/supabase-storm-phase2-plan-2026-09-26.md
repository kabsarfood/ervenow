# إقفال المرحلة 1 + خطة المرحلة 2
التاريخ: 2026-09-26

المرحلة 2 لم تُنفَّذ. SQL المحفظة جاهز للتنفيذ اليدوي في Supabase ولم يُشغَّل من هنا.

ملاحظة معتمدة ومؤجلة: `/api/wallet/transactions` ما زال يُطلب كل 30 ثانية مع نبض اللوحة. قائمة الحركات تُجلب لاحقاً عند فتح قسم المحفظة أو بعد عملية مالية، وليست ضمن بنود المرحلة 2 أدناه.

## هل دالة التجميع آمنة وidempotent؟

نعم، بالشروط التالية:

- CREATE OR REPLACE بنفس التوقيع (uuid, text, timestamptz) يستبدل جسم الدالة فقط. تشغيله مرتين لا ينشئ جدولاً ولا صفاً ولا يغيّر رصيداً مخزناً.
- الدالة STABLE وتقرأ فقط. لا تستدعي ervenow_ledger_ensure_wallet ولا تعمل INSERT أو UPDATE.
- GRANT و REVOKE على نفس الصلاحية آمنان عند التكرار.
- PostgreSQL يمنح EXECUTE إلى PUBLIC عند إنشاء الدالة. لذلك السكربت يسحب الصلاحية من PUBLIC و anon و authenticated ويبقيها لـ service_role فقط. بدون هذا السحب يستطيع مفتاح anon قراءة محفظة أي مستخدم لأن الدالة SECURITY DEFINER.
- إذا وُجدت سابقاً دالة بنفس الاسم وبتوقيع مختلف، OR REPLACE لا يحذفها. التوقيع الحالي غير موجود في هجرات المستودع قبل هذا الملف.
- earned_today يُحسب فقط إذا مُرّر p_today_start. الخادم يمرّره دائماً (منتصف الليل المحلي). حذفه من الاستدعاء يعيد 0 لربح اليوم ولا يغيّر الرصيد.

## SQL النهائي

الصق محتوى الملف `shared/migration_ervenow_ledger_wallet_aggregate.sql` كما هو في محرر SQL في Supabase وشغّله مرة واحدة. آخر ثلاث أسطر هي REVOKE ثم GRANT.

## التحقق بعد التنفيذ

85 و 0 و 80 هي نتائج اختبار Jest على بيانات وهمية، وليست أرصدة مستخدمين حقيقيين.

معانيها:
- 0: لا توجد محفظة لهذا المستخدم والدور.
- 85: إتمام دائن 100 من نوع earning ناقص إتمام مدين 15 من نوع commission. total_credits=100 و total_debits=15 و total_earned=100 و total_commission=15.
- 80: نفس الشكل مع عمولة 20 بدل 15. اختبار Jest أعاد balance=80 و total_earned=100 و total_commission=20 من mock. عدّ الحركات في ذلك الـ mock كان 3 كقيمة ثابتة وليس ثلاث صفوف يجب إعادة إنتاجها.

الخطوة 1، قراءة فقط، حالة 0:

```sql
SELECT public.ervenow_ledger_wallet_aggregate(
  '00000000-0000-0000-0000-000000000000'::uuid,
  'service',
  now()
);
```

المتوقع: ok=true و has_data=false و available_balance=0 و balance=0 و pending_balance=0 و total_credits=0 و total_debits=0 و total_earned=0 و total_commission=0 و earned_today=0 و transaction_count=0.

الخطوة 2، محفظة حقيقية واحدة، مقارنة مع الجمع اليدوي. استبدل المعرّف إن لزم:

```sql
WITH w AS (
  SELECT id, user_id, role
  FROM public.ervenow_ledger_wallets
  WHERE user_id IS NOT NULL
  ORDER BY created_at
  LIMIT 1
),
manual AS (
  SELECT
    round(coalesce(sum(CASE WHEN t.status = 'completed' AND t.direction = 'credit' THEN t.amount ELSE 0 END), 0), 2) AS total_credits,
    round(coalesce(sum(CASE WHEN t.status = 'completed' AND t.direction = 'debit' THEN t.amount ELSE 0 END), 0), 2) AS total_debits
  FROM public.ervenow_ledger_transactions t
  JOIN w ON t.wallet_id = w.id
),
rpc AS (
  SELECT public.ervenow_ledger_wallet_aggregate(w.user_id, w.role, date_trunc('day', now())) AS j
  FROM w
)
SELECT
  (rpc.j->>'available_balance')::numeric AS rpc_balance,
  (manual.total_credits - manual.total_debits) AS manual_balance,
  (rpc.j->>'available_balance')::numeric = (manual.total_credits - manual.total_debits) AS balance_matches,
  (rpc.j->>'total_credits')::numeric = manual.total_credits AS credits_match,
  (rpc.j->>'total_debits')::numeric = manual.total_debits AS debits_match
FROM rpc, manual;
```

المتوقع: balance_matches و credits_match و debits_match كلها true.

الخطوة 3، إثبات 85 ثم 80 ثم التراجع. شغّل الكتلة كاملة. السطر الأخير ROLLBACK. afterward يجب أن يكون عدّ المرجعَين صفراً.

```sql
BEGIN;

DO $$
DECLARE
  uid uuid;
  wid uuid;
  r jsonb;
BEGIN
  SELECT u.id INTO uid
  FROM public.users u
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.ervenow_ledger_wallets w
    WHERE w.user_id = u.id AND w.role = 'restaurant'
  )
  LIMIT 1;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'no user without a restaurant wallet; skip this block';
  END IF;

  INSERT INTO public.ervenow_ledger_wallets (user_id, role, balance)
  VALUES (uid, 'restaurant', 0)
  RETURNING id INTO wid;

  INSERT INTO public.ervenow_ledger_transactions
    (wallet_id, type, direction, amount, status, reference_id)
  VALUES
    (wid, 'earning', 'credit', 100, 'completed', 'phase1-verify-85-credit'),
    (wid, 'commission', 'debit', 15, 'completed', 'phase1-verify-85-debit');

  r := public.ervenow_ledger_wallet_aggregate(uid, 'restaurant', now());
  IF (r->>'available_balance')::numeric <> 85
     OR (r->>'total_credits')::numeric <> 100
     OR (r->>'total_debits')::numeric <> 15
     OR (r->>'total_earned')::numeric <> 100
     OR (r->>'total_commission')::numeric <> 15 THEN
    RAISE EXCEPTION 'case 85 failed: %', r;
  END IF;

  UPDATE public.ervenow_ledger_transactions
  SET amount = 20
  WHERE wallet_id = wid AND reference_id = 'phase1-verify-85-debit';

  r := public.ervenow_ledger_wallet_aggregate(uid, 'restaurant', now());
  IF (r->>'available_balance')::numeric <> 80
     OR (r->>'total_earned')::numeric <> 100
     OR (r->>'total_commission')::numeric <> 20
     OR (r->>'total_debits')::numeric <> 20 THEN
    RAISE EXCEPTION 'case 80 failed: %', r;
  END IF;

  RAISE NOTICE 'cases 85 and 80 passed';
END $$;

ROLLBACK;

SELECT count(*) AS leftover_rows
FROM public.ervenow_ledger_transactions
WHERE reference_id IN ('phase1-verify-85-credit', 'phase1-verify-85-debit');
```

المتوقع: NOTICE أن الحالتين نجحتا، ثم leftover_rows = 0. إذا فشل الإدراج بسبب trigger، لا تعمل COMMIT. المعاملة تتراجع والتحقق الحي في الخطوة 2 يبقى كافياً.

بعد نجاح الدالة، لوحة الخدمة تستخدم استعلاماً واحداً بدل نحو 12 عملية مجمعة.

## خطة المرحلة 2 (بدون تنفيذ)

ترتيب التنفيذ المقترح بعد الاعتماد: 1 الحضور، 2 إحصاءات الأدمن، 3 الملخص المالي، 4 البانرات، 5 موقع السائق. Auth يبقى حتى تتوفر اللوجات.

### 1. حضور موقع المزوّد كل 15 ثانية

الوضع الحالي: `startPresenceLoop` في `portal-provider-location.js` على service-preview و transport-preview. كل 15 ثانية يستدعي الحفظ. `shouldSaveCoords` يعيد true إذا مر أكثر من 12 ثانية حتى لو لم تتحرك الإحداثيات، لذلك النبض يكتب في كل دورة. `watchPosition` يكتب أيضاً عند انزياح أكبر من 0.00008 درجة. لا يوجد فحص `document.hidden`. الكتابة PATCH إلى `/api/services/me/location`.

عدد الطلبات المتوقع: تبويب خدمة واحد ثابت المكان نحو 240 كتابة/ساعة وهو ظاهر، وتستمر الكتابة وهو مخفي ما لم يخنق المتصفح المؤقت. انزياح GPS يضيف كتابات فوق ذلك.

الإصلاح: لا تكتب إذا لم تتغير الإحداثيات فوق العتبة. أوقف interval و watch عند `document.hidden`، وعند الرجوع اكتب مرة واحدة فقط إذا تغيّر الموقع. أبقِ العتبة الحالية حتى لا يتغير سلوك التتبع أثناء الحركة.

العدد بعد الإصلاح: تبويب ثابت ظاهر: كتابة واحدة ثم صفر. تبويب مخفي: صفر. أثناء الحركة: كتابة لكل انزياح فوق العتبة.

مخاطر التغيير: مزوّد واقف لن يُحدَّث ختم وقته كل 15 ثانية. إذا كان التوزيع يعتمد على «آخر تحديث» وليس على تغير الإحداثيات، قد يُعتبر غير متصل. يجب الإبقاء على أول كتابة عند فتح البوابة.

### 2. admin/stats

الوضع الحالي: `admin-dashboard.html` يستدعي الإحصاءات كل 30 ثانية. `computeAdminDashboardStats` يعمل 3 عمليات count ثم يسحب كل الطلبات على صفحات من 1000 حتى 80 صفحة، مرتين (أرقام الإيراد وصفوف الرسم). الحساب في Node: إيراد غير الملغى، عمولة المنصة، أجر المندوب، إيراد اليوم، والرسم حسب المدى.

عدد الطلبات المتوقع: تبويب أدمن واحد = 120 دورة/ساعة. جدول صغير (صفحة واحدة): نحو 5 استعلامات × 120 = 600/ساعة. آلاف الطلبات (مثلاً 5 صفحات): نحو 13 × 120 = 1560/ساعة. السقف النظري: 163 استعلاماً × 120 = حوالي 19500/ساعة.

الإصلاح: RPC واحد يعيد العدّ والمجاميع ونقاط الرسم مجمّعة حسب اليوم، بنفس تعريف الإيراد واستبعاد الملغى. أوقف الاستطلاع عند `document.hidden`.

العدد بعد الإصلاح: 1 إلى 2 استعلام × 120 = 120 إلى 240/ساعة للتبويب الظاهر، وصفر وهو مخفي.

مخاطر التغيير: اختلاف تقريب الأرقام أو تعريف `orderBillableAmount` أو منطقة منتصف الليل. الرسم يجب أن يبقى بنفس المفاتيح التي تقرأها الواجهة.

### 3. admin finance-summary

الوضع الحالي: نفس لوحة الأدمن، كل 15 ثانية إذا كانت صلاحية المالية موجودة، حتى لو اللوحة المالية غير مفتوحة. `getAdminFinanceSummaryFromLedger` يستدعي RPC `ervenow_ledger_finance_summary` الموجود، ثم يسحب آخر 20 حركة، ثم تنبيهات (سحوبات، حركات كبيرة، حركات الدقيقة)، وقد يشغّل تنبيه الديون كأثر جانبي في كل دورة.

عدد الطلبات المتوقع: 240 دورة/ساعة. نحو 5 إلى 8 استعلامات في الدورة = حوالي 1200 إلى 1920 استعلام/ساعة لتبويب أدمن واحد يملك صلاحية المالية.

الإصلاح: أبقِ RPC الملخص كما هو. لا تسحب آخر 20 حركة والتنبيهات إلا واللوحة المالية ظاهرة، وبفاصل أطول (60 ثانية). لا تشغّل إشعار الديون من نبض الواجهة.

العدد بعد الإصلاح: اللوحة المالية مغلقة: صفر من هذا النبض. وهي مفتوحة: نحو 2 إلى 4 استعلامات × 60 = 120 إلى 240/ساعة.

مخاطر التغيير: تأخر ظهور التنبيه حتى دقيقة. إشعار الدين يجب أن يبقى على حدث مالي حقيقي حتى لا يتوقف التنبيه ولا يتكرر كل 15 ثانية.

### 4. hero_banners و marketing/home

الوضع الحالي: `getActiveBannersByTarget` يلف على 17 هدفاً، وكل هدف يعمل `listBanners` فيسحب جدول `hero_banners` كاملاً ثم يصفّي في الذاكرة. `GET /api/core/marketing/home` يستدعي هذا المسار مرة (17 استعلاماً) بالإضافة إلى عروض المنصة. المتصفح يطلب الصفحة بـ `cache: "no-store"` رغم أن الاستجابة تعلن max-age=60. `GET /api/core/hero-banner` يستدعي التجميع مرتين فيصير نحو 34 استعلاماً.

عدد الطلبات المتوقع: كل فتح للرئيسية ≈ 18 استعلام Supabase. 100 فتح/ساعة ≈ 1800 استعلام. مسار hero-banner المنفصل يضاعف الحلقة إلى 34 في الطلب الواحد.

الإصلاح: استعلام واحد لكل البانرات، ثم التقسيم على الأهداف في الذاكرة، مع ذاكرة خادم 60 ثانية. أبقِ رأس الكاش. لا تغيّر كتابة الانطباع والنقرة؛ هما مسار POST منفصل.

العدد بعد الإصلاح: استعلام بانرات واحد كل 60 ثانية لكل عملية خادم، مهما كان عدد فتحات الصفحة في تلك الدقيقة. 100 فتح/ساعة تنزل من نحو 1700 استعلام بانرات إلى نحو 60. العروض تبقى استعلاماً واحداً لكل فتح إلى أن تُقرر لاحقاً.

مخاطر التغيير: بانر جديد أو موقف يظهر متأخراً حتى 60 ثانية. خطأ في `bannerHasTarget` يغيّر مكان العرض. أكثر من عملية خادم تعني ذاكرة مستقلة لكل عملية.

### 5. موقع السائق

الوضع الحالي:
- `driver-app.html`: أثناء رحلة نشطة يرسل الموقع كل 8 ثوانٍ بلا فحص حركة. يتوقف عند `document.hidden`.
- `driver.html`: حلقة الرحلة كل 8 ثوانٍ، و`shouldSend` يعيد true إذا مر 5 ثوانٍ حتى بدون حركة، فالإرسال يحصل كل دورة. حلقة الحضور كل 15 ثانية تستدعي الإرسال مباشرة بلا فحص حركة، وتتوقف عند الإخفاء.
- `driver-preview.js`: الحضور كل 15 ثانية. أثناء رحلة نشطة يرسل إذا تحركت النقطة أو مر 8 ثوانٍ. بدون رحلة يرسل عند الحركة وبعد 60 ثانية.

عدد الطلبات المتوقع: رحلة ظاهرة في driver-app: 450 POST/ساعة إلى `/api/driver/update-location` حتى والسائق واقف. driver.html مشابه لأن شرط الخمس ثوانٍ يمر قبل الدورة التالية. التبويب المخفي في هذين الملفين: صفر تقريباً. driver-preview أثناء رحلة: نحو 450/ساعة أيضاً.

الإصلاح: أرسل فقط عند تغيّر معتبر (أبقِ عتبة الحركة الموجودة في كل ملف، واحذف شرط «مرّ وقت قصير فأرسل رغم الثبات»). أوقف الحلقات عند `document.hidden` حيث لم تكن متوقفة. أول نقطة في الرحلة تُرسل دائماً.

العدد بعد الإصلاح: سائق واقف في رحلة ظاهرة: إرسال واحد ثم صفر. سائق يتحرك: إرسال عند تجاوز العتبة فقط. مخفي: صفر.

مخاطر التغيير: الخريطة الحية للعميل تتحدث أبطأ إذا كان السائق بطيئاً تحت العتبة. يجب ألا يتوقف الإرسال أول مرة بعد قبول الطلب، وإلا تبقى الخريطة بلا نقطة.

Auth (6560 خطأ) خارج هذه الخطة حتى تتوفر لوجات User-Agent والمسار.
