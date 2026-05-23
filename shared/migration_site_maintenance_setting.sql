-- وضع صيانة الموقع (يُخزَّن في platform_settings ليعمل على Railway بعدة نسخ)
INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('site_maintenance_enabled', '0', now())
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
