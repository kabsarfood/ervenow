-- =============================================================================
-- ERVENOW — STORES RLS SECURITY
-- =============================================================================
-- الحالة: للمراجعة فقط — لا تُنفَّذ على Supabase حتى اعتماد الفريق.
--
-- يغلق تحذيرات Supabase Security Advisor لـ:
--   • public.stores
--   • public.order_number_counters
--
-- الافتراضات (من تدقيق المستودع):
--   • الخادم (Node) يستخدم createServiceClient() = service_role → يتجاوز RLS.
--   • لا يوجد Supabase client مباشر في الواجهة الأمامية.
--   • auth.uid() غير مستخدم — سياسات deny-by-default على anon/authenticated.
--
-- نفّذ يدوياً في Supabase → SQL Editor بعد:
--   1) تشغيل PRE-FLIGHT (القسم 0) وقراءة النتائج
--   2) مراجعة Regression Checklist (القسم 4)
--   3) تنفيذ الأقسام 1–3
-- =============================================================================


-- =============================================================================
-- 0) PRE-FLIGHT — استعلامات تشخيصية (SELECT فقط — لا تغيّر البيانات)
-- =============================================================================
-- انسخ ونفّذ كل استعلام على حدة قبل الهجرة:

-- 0.a) هل order_number_counters موجود؟
-- SELECT to_regclass('public.order_number_counters') AS tbl,
--        (SELECT count(*) FROM public.order_number_counters) AS row_count
-- WHERE to_regclass('public.order_number_counters') IS NOT NULL;

-- 0.b) تبعيات FK على order_number_counters
-- SELECT conrelid::regclass AS referencing_table, conname
-- FROM pg_constraint
-- WHERE confrelid = 'public.order_number_counters'::regclass;

-- 0.c) سياسات RLS الحالية على stores
-- SELECT policyname, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'stores';

-- 0.d) صلاحيات GRANT الحالية على stores
-- SELECT grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND table_name = 'stores'
-- ORDER BY grantee, privilege_type;

-- 0.e) أعمدة stores الحساسة (تحقق من وجودها قبل VIEW)
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'stores'
--   AND column_name IN (
--     'iban', 'bank_iban', 'bank_account_number', 'bank_swift_code',
--     'phone', 'email', 'stc_pay_phone', 'payout_iban_fingerprint',
--     'commercial_register', 'commercial_registration', 'file_url', 'owner_user_id'
--   )
-- ORDER BY column_name;


-- =============================================================================
-- 1) المرحلة 1 — public.order_number_counters
-- =============================================================================
-- نتيجة تدقيق المستودع (ervenow):
--   • لا مراجع في الكود لـ order_number_counters.
--   • أرقام الطلبات: shared/utils/generateOrderNumber.js + orders.order_number.
--   • الحكم: جدول يُرجَّح أنه orphan (أُنشئ خارج migrations المتتبعة).
--
-- التوصية:
--   A) افتراضي آمن: ENABLE RLS + deny-by-default (الأقسام 1.a–1.c).
--   B) اختياري بعد PRE-FLIGHT 0.a–0.b: DROP TABLE (القسم 1.d — معلّق).
-- =============================================================================

-- 1.a) تفعيل RLS (إن وُجد الجدول)
DO $$
BEGIN
  IF to_regclass('public.order_number_counters') IS NOT NULL THEN
    ALTER TABLE public.order_number_counters ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'order_number_counters: RLS enabled';
  ELSE
    RAISE NOTICE 'order_number_counters: table not found — skip (no Supabase warning expected)';
  END IF;
END $$;

-- 1.b) إزالة أي سياسات قديمة + deny-by-default صريح
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.order_number_counters') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'order_number_counters'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.order_number_counters', r.policyname);
  END LOOP;

  CREATE POLICY "order_number_counters_deny_anon"
    ON public.order_number_counters
    FOR ALL TO anon
    USING (false) WITH CHECK (false);

  CREATE POLICY "order_number_counters_deny_authenticated"
    ON public.order_number_counters
    FOR ALL TO authenticated
    USING (false) WITH CHECK (false);
END $$;

-- 1.c) REVOKE مباشر من PostgREST roles
DO $$
BEGIN
  IF to_regclass('public.order_number_counters') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.order_number_counters FROM anon, authenticated;
    GRANT ALL ON TABLE public.order_number_counters TO service_role;
  END IF;
END $$;

-- 1.d) اختياري — حذف orphan (لا تُفعّل إلا بعد PRE-FLIGHT + موافقة)
-- DO $$
-- BEGIN
--   IF to_regclass('public.order_number_counters') IS NULL THEN
--     RAISE NOTICE 'order_number_counters: already absent';
--     RETURN;
--   END IF;
--   IF EXISTS (
--     SELECT 1 FROM pg_constraint
--     WHERE confrelid = 'public.order_number_counters'::regclass
--   ) THEN
--     RAISE EXCEPTION 'order_number_counters has FK dependents — use RLS lockdown only';
--   END IF;
--   DROP TABLE public.order_number_counters;
--   RAISE NOTICE 'order_number_counters: dropped';
-- END $$;


-- =============================================================================
-- 2) المرحلة 2 — public.stores: RLS deny-by-default + stores_public VIEW
-- =============================================================================

-- 2.a) إزالة سياسات RLS القديمة (إن وُجدت)
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'public.stores not found';
  END IF;

  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stores'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stores', r.policyname);
  END LOOP;
END $$;

-- 2.b) تفعيل RLS — بدون سياسات permissive = deny-by-default
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- 2.c) deny-by-default صريح (defense-in-depth — يغلق PostgREST anon/authenticated)
DROP POLICY IF EXISTS "stores_deny_anon" ON public.stores;
CREATE POLICY "stores_deny_anon"
  ON public.stores
  FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "stores_deny_authenticated" ON public.stores;
CREATE POLICY "stores_deny_authenticated"
  ON public.stores
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- service_role يتجاوز RLS في Supabase — لا حاجة لسياسة permissive.
-- (اختياري للتوثيق فقط — غير مطلوب للتشغيل)
-- DROP POLICY IF EXISTS "stores_service_role_all" ON public.stores;
-- CREATE POLICY "stores_service_role_all"
--   ON public.stores FOR ALL TO service_role
--   USING (true) WITH CHECK (true);

-- 2.d) REVOKE على الجدول الأساسي — الوصول العام عبر VIEW فقط
REVOKE ALL ON TABLE public.stores FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stores TO service_role;

-- 2.e) VIEW عامة — أعمدة آمنة فقط (لا iban ولا bank_* الحساسة)
--     security_invoker = false → يُقيَّم كمالك العرض (postgres) فيتجاوز RLS على stores.
DROP VIEW IF EXISTS public.stores_public;

CREATE VIEW public.stores_public
WITH (security_invoker = false)
AS
SELECT
  s.id,
  s.name,
  s.type,
  s.category,
  s.status,
  s.is_active,
  s.lat,
  s.lng,
  s.address,
  s.location_text,
  s.delivery_radius_km,
  s.logo_url,
  s.average_rating,
  s.rating_count,
  s.total_orders,
  s.profile_views,
  s.delivery_policy,
  s.free_delivery_policy,
  s.free_delivery_min_order,
  s.free_delivery_radius_km,
  s.delivery_fee_per_km,
  s.bank_last4,
  s.bank_verified,
  s.created_at,
  s.updated_at
FROM public.stores s
WHERE lower(trim(coalesce(s.status, ''))) = 'approved'
  AND coalesce(s.is_active, false) = true;

COMMENT ON VIEW public.stores_public IS
  'عرض عام للمتاجر المعتمدة والنشطة — بدون phone/email/iban/bank_iban/bank_account_number/bank_swift_code/commercial_register/file_url/owner_user_id';

-- أعمدة مُستبعدة عن قصد (حماية):
--   iban, bank_iban, bank_account_number, bank_swift_code
--   bank_account_name, bank_name, bank_country_code, bank_added_at
--   stc_pay_phone, payout_iban_fingerprint, payout_crypto_interest
--   phone, email, commercial_register, commercial_registration, file_url, owner_user_id

GRANT SELECT ON public.stores_public TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stores_public FROM anon, authenticated;

-- 2.f) حماية إضافية على أعمدة بنكية (GRANT column-level — PG 16+ / Supabase حديث)
--     إن فشل: تجاهل — RLS + VIEW + REVOKE كافية لـ PostgREST.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    REVOKE SELECT (iban, bank_iban, bank_account_number, bank_swift_code)
      ON public.stores FROM anon, authenticated;
    RAISE NOTICE 'stores: column-level REVOKE applied (PG16+)';
  ELSE
    RAISE NOTICE 'stores: column-level REVOKE skipped (requires PG16+) — rely on RLS+VIEW';
  END IF;
EXCEPTION
  WHEN undefined_column THEN
    RAISE NOTICE 'stores: some bank columns missing — column REVOKE skipped';
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'stores: column REVOKE skipped (insufficient_privilege)';
END $$;


-- =============================================================================
-- 3) POST-MIGRATION VERIFICATION (SELECT — نفّذ بعد الهجرة)
-- =============================================================================

-- 3.a) RLS مفعّل
-- SELECT relname, relrowsecurity, relforcerowsecurity
-- FROM pg_class
-- WHERE relname IN ('stores', 'order_number_counters') AND relnamespace = 'public'::regnamespace;

-- 3.b) anon لا يرى stores مباشرة (يجب 0 rows أو permission denied عبر PostgREST)
-- SET ROLE anon;
-- SELECT count(*) FROM public.stores;          -- expect: 0 or error
-- SELECT count(*) FROM public.stores_public;   -- expect: >= 0
-- RESET ROLE;

-- 3.c) stores_public لا يحتوي أعمدة حساسة
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'stores_public'
--   AND column_name IN ('iban','bank_iban','bank_account_number','bank_swift_code','phone','email');
-- -- expect: 0 rows

-- 3.d) Security Advisor — أعد فحص Supabase Dashboard → Advisors


NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- 4) REGRESSION CHECKLIST — تحقق يدوي بعد التنفيذ
-- =============================================================================
--
-- □ Store Account
--   □ تسجيل دخول متجر (/login?role=store)
--   □ /store-dashboard — تحميل البيانات والمنتجات
--   □ إضافة/تعديل منتج
--   □ إعدادات المتجر (hub، شعار، موقع)
--   □ تحديث بيانات بنكية (iban مشفّر عبر API — لا 403/500)
--   □ معاينة المتجر (preview=1)
--
-- □ Delivery Engine
--   □ سياسة التوصيل (delivery_policy) تظهر في checkout
--   □ إنشاء طلب توصيل متجر — order_number يُولَّد (ليس من order_number_counters)
--   □ OTP استلام المتجر
--
-- □ Wallet
--   □ رصيد store_wallets يظهر في لوحة المتجر
--   □ store_wallet_credit_for_order بعد تسليم طلب
--
-- □ Withdrawals
--   □ طلب سحب من المتجر
--   □ موافقة إدارة على سحب (store_wallet_approve_withdrawal)
--
-- □ Registration
--   □ تسجيل متجر جديد (status=pending)
--   □ لا يظهر في stores_public قبل الموافقة
--   □ موافقة إدارة → is_active=true → يظهر في browse
--
-- □ Admin
--   □ قائمة المتاجر pending/approved
--   □ عرض تفاصيل متجر (بما فيها bank_last4 — بدون ciphertext)
--   □ approve/reject store
--
-- □ Checkout
--   □ GET /api/stores (browse) — قائمة معتمدة
--   □ GET /api/stores/:id — تفاصيل متجر + منتجات
--   □ checkout payment methods من store_merchant_hub
--   □ إتمام طلب مدفوع (EwPay / COD)
--
-- □ PostgREST / Security (curl أو Supabase client بمفتاح anon)
--   □ GET /rest/v1/stores → [] أو 401/403 (لا صفوف)
--   □ GET /rest/v1/stores?select=iban → مرفوض
--   □ GET /rest/v1/stores_public → صفوف معتمدة فقط، بدون أعمدة بنكية
--   □ GET /rest/v1/order_number_counters → [] أو مرفوض
--
-- □ service_role (Node :4000)
--   □ /api/health OK
--   □ لا regressions في اختبارات: tests/unit/storeMerchantLedgerCredit.test.js
--     tests/unit/storeOrderPostCheckout.test.js (إن وُجدت)
--
-- =============================================================================
-- ROLLBACK (طوارئ — للمراجعة فقط)
-- =============================================================================
--
-- DROP VIEW IF EXISTS public.stores_public;
-- DROP POLICY IF EXISTS "stores_deny_anon" ON public.stores;
-- DROP POLICY IF EXISTS "stores_deny_authenticated" ON public.stores;
-- ALTER TABLE public.stores DISABLE ROW LEVEL SECURITY;
-- GRANT SELECT ON public.stores TO anon, authenticated;  -- ⚠ يعيد التعرية — لا تستخدم إلا مؤقتاً
--
-- DROP POLICY IF EXISTS "order_number_counters_deny_anon" ON public.order_number_counters;
-- DROP POLICY IF EXISTS "order_number_counters_deny_authenticated" ON public.order_number_counters;
-- ALTER TABLE public.order_number_counters DISABLE ROW LEVEL SECURITY;
--
-- =============================================================================
