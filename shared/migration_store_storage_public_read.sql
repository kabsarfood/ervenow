-- جعل صور المتجر (شعار/غلاف/منتجات) قابلة للقراءة العامة من المتصفح
-- نفّذ في Supabase SQL Editor بعد إنشاء الدلو: erwenow-store-registrations (أو ERVENOW_STORE_FILES_BUCKET)

-- Supabase Dashboard → Storage → New bucket → erwenow-store-registrations → Public bucket (موصى به)
-- أو السياسة التالية إن كان الدلو خاصاً:

DROP POLICY IF EXISTS "ervenow_store_files_public_read" ON storage.objects;
CREATE POLICY "ervenow_store_files_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'erwenow-store-registrations');
