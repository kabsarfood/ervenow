-- توحيد عمولة المنصة على 7% (بدل 12% الافتراضية القديمة)
UPDATE public.commission_rules
SET rate = 0.07, updated_at = now()
WHERE rate = 0.12 AND is_active = true;

INSERT INTO public.commission_rules (rate, applies_to, country_code, is_active)
SELECT 0.07, v.applies, 'SA', true
FROM (VALUES ('merchant'), ('delivery'), ('service')) AS v(applies)
WHERE NOT EXISTS (
  SELECT 1 FROM public.commission_rules cr
  WHERE cr.applies_to = v.applies AND cr.country_code = 'SA' AND cr.is_active = true
);

NOTIFY pgrst, 'reload schema';
