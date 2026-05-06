-- =============================================================================
-- موقع المتجر الإلزامي + عنوان + نطاق التوصيل
-- نفّذ بعد migration_stores.sql و migration_store_marketplace.sql
-- (أعمدة lat/lng: إن واجهت schema cache نفّذ أيضاً migration_stores_lat_lng.sql)
-- =============================================================================

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS lng double precision;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS delivery_radius_km numeric NOT NULL DEFAULT 5;

UPDATE public.stores
SET address = COALESCE(NULLIF(trim(address), ''), NULLIF(trim(location_text), ''))
WHERE (address IS NULL OR trim(address) = '')
  AND location_text IS NOT NULL
  AND trim(location_text) <> '';

COMMENT ON COLUMN public.stores.delivery_radius_km IS 'نصف قطر التوصيل بالكم — العميل يجب أن يكون ضمن هذه المسافة من المتجر';
