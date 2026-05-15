-- الخطوة 1 فقط: إنشاء جدول إعدادات المنصة (ينفَّذ في Supabase SQL Editor أو عبر عميل Postgres)
CREATE TABLE IF NOT EXISTS platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  type TEXT DEFAULT 'string',
  description TEXT,
  updated_at TIMESTAMP DEFAULT now()
);

NOTIFY pgrst, 'reload schema';
