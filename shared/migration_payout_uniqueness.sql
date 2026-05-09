-- =============================================================================
-- ERVENOW — migration_payout_uniqueness.sql
-- =============================================================================
-- الهدف: أعمدة بصمة الآيبان + iqama_digits للمندوبين + فهارس فريدة دفاعية.
--
-- نفّذ في Supabase → SQL Editor (يفضّل بعد migration_bank_drivers_stores_secure.sql
-- و migration_drivers.sql إن وُجدت).
--
-- ملاحظات:
-- * منع «نفس الآيبان لجهات مختلفة» بين users/drivers/stores يُكمّل في التطبيق
--   (shared/utils/payoutUniqueness.js) مع استثناء «نفس المالك» حسب الجوال.
-- * الفهارس الفريدة هنا تمنع التكرار داخل نفس الجدول فقط (backward compatible).
-- * إن فشل CREATE UNIQUE INDEX بسبب بيانات مكررة قديماً: نظّف التكرار ثم أعد التنفيذ.
-- =============================================================================

-- ——— أعمدة (آمنة عند إعادة التشغيل) ———
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS iqama_digits text,
  ADD COLUMN IF NOT EXISTS payout_iban_fingerprint text;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS payout_iban_fingerprint text;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS payout_iban_fingerprint text;

-- ——— تعبئة iqama_digits من iqama عند الإمكان ———
UPDATE public.drivers
SET iqama_digits = regexp_replace(coalesce(iqama, ''), '\D', '', 'g')
WHERE (iqama_digits IS NULL OR btrim(iqama_digits) = '')
  AND coalesce(btrim(iqama), '') <> '';

-- ——— تعليقات أعمدة ———
COMMENT ON COLUMN public.drivers.iqama_digits IS 'أرقام الهوية/الإقامة فقط — فهرس فريد شرطي';
COMMENT ON COLUMN public.drivers.payout_iban_fingerprint IS 'SHA256(IBAN بعد التطبيع) — بصمة للتحقق ومنع التكرار داخل جدول المندوبين';
COMMENT ON COLUMN public.stores.payout_iban_fingerprint IS 'SHA256(IBAN بعد التطبيع) — بصمة للتحقق ومنع التكرار داخل جدول المتاجر';
COMMENT ON COLUMN public.users.payout_iban_fingerprint IS 'SHA256(IBAN بعد التطبيع) — بصمة للتحقق ومنع التكرار داخل جدول المستخدمين';

-- ——— فريد: هوية/إقامة مندوب (8+ أرقام فقط) ———
CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_iqama_digits
  ON public.drivers (iqama_digits)
  WHERE iqama_digits IS NOT NULL AND length(iqama_digits) >= 8;

-- ——— فريد: نفس جوال المتجر لا يُكرّر في طلب قيد المراجعة أو متجر معتمد ———
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_phone_pending_approved
  ON public.stores (phone)
  WHERE status IN ('pending', 'approved');

-- ——— فريد جزئي: نفس بصمة الآيبان لا تتكرر داخل users (NULL يُتجاهل) ———
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_payout_iban_fingerprint
  ON public.users (payout_iban_fingerprint)
  WHERE payout_iban_fingerprint IS NOT NULL AND btrim(payout_iban_fingerprint) <> '';

-- ——— فريد جزئي: داخل drivers ———
CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_payout_iban_fingerprint
  ON public.drivers (payout_iban_fingerprint)
  WHERE payout_iban_fingerprint IS NOT NULL AND btrim(payout_iban_fingerprint) <> '';

-- ——— فريد جزئي: داخل stores ———
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_payout_iban_fingerprint
  ON public.stores (payout_iban_fingerprint)
  WHERE payout_iban_fingerprint IS NOT NULL AND btrim(payout_iban_fingerprint) <> '';

NOTIFY pgrst, 'reload schema';
