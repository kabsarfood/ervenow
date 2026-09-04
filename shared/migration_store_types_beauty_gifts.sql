-- توسيع أنواع المتاجر: تجميل وعناية + ورود وهدايا + حلويات
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_type_check;
ALTER TABLE public.stores
  ADD CONSTRAINT stores_type_check CHECK (
    type IN (
      'restaurant',
      'pharmacy',
      'supermarket',
      'minimarket',
      'vegetables',
      'butcher',
      'fish',
      'home_business',
      'services',
      'flowers_gifts',
      'beauty_care',
      'clothing',
      'sweets',
      'other'
    )
  );
