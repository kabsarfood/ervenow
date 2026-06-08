-- تفعيل صفحة الخريطة الحية للزوار (1 = مفعّلة، 0 = مخفية)
INSERT INTO platform_settings (key, value, updated_at)
VALUES ('live_map_public_enabled', '1', now())
ON CONFLICT (key) DO NOTHING;
