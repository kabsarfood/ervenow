# تدقيق Security Advisor — فحص فقط

التاريخ: 2026-09-25. لم يُنفَّذ SQL ولا GRANT ولا Policy.

لوحة المستشار: 0 Errors. التحذيرات الـ35 تتوزع تقريباً على: 8 دوال Definer مكشوفة للعامة والمسجلين، 11 سياسة RLS مفتوحة، 10 دوال بلا search_path، ودلو تخزين واحد عام. بقية دوال المحفظة (نحو 20) منفّذة كـ Definer لكن EXECUTE لها محصور في service_role، وليست ضمن تحذير Public.

## 1. الدلو

الاسم الفعلي: `erwenow-store-registrations` (بحرف w زائد). عام، والصور فقط حتى 10MB.
سياسة واحدة: `ervenow_store_files_public_read` للأمر SELECT على كل الأدوار، بشرط أن يكون الملف داخل هذا الدلو. هذا يسمح بالـlisting والتنزيل للمفتاح العام.

المحتوى الحالي: شعارات 42، بنرات 39، منتجات 18، سجل تجاري `cr` بعدد 14. لا مجلد رخص ظاهر الآن.
الرفع من السيرفر عبر service_role في تسجيل المتجر ولوحة التاجر: مجلدات logo و banner و products و cr و license.
المتصفح لا يرفع إلى Storage مباشرة.

اقتراح لاحقاً: جعل الدلو خاصاً، وإبقاء الرفع والتوقيع من السيرفر. روابط الشعارات القديمة العامة قد تتوقف حتى يُعاد توقيعها.

## 2. Security Definer المكشوف

هذه الثمانية تقبل EXECUTE من anon و authenticated و service_role، والمالك postgres، وsearch_path مضبوط. لا فحص لدور المستدعي داخل الدالة: من يعرف المعرّف أو الرمز ينفّذ العملية.

- ledger_withdraw_request_approve: يعتمد سحباً معلقاً. يستدعيها الأدمن في السيرفر فقط.
- store_wallet_approve_withdrawal: يعتمد سحب متجر. الأدمن في السيرفر فقط.
- store_wallet_credit_for_order: يزيد رصيد المتجر. لا استدعاء من المتصفح.
- ervenow_redeem_topup_code: يشحن رمزاً إلى user_id يمرره المستدعي.
- settlement_log_try_claim: يسجّل مطالبة تسوية وقد يمنع التسوية الحقيقية. السيرفر فقط.
- generate_order_number: يستهلك رقماً. السيرفر أو التريغر.
- withdraw_requests_view_insert: تريغر إدراج، وليس مسار محفظة مستقلاً.
- rls_auto_enable: event trigger عند إنشاء جدول، وليس RPC يستدعيه العميل.

اقتراح لاحقاً: سحب EXECUTE من anon و authenticated والإبقاء على service_role. السيرفر لن ينكسر لأن نداءاته تملك صلاحية الخدمة. التريغرات تبقى لأنها Definer.

## 3. RLS Always True

الخطر الحقيقي حيث الدور public ومعه GRANT كامل:

- orders: سياسة Allow all لكل الأوامر وللدور public، وUSING(true). anon يستطيع القراءة والكتابة.
- users: allow select و allow insert للدور public. anon يقرأ كل المستخدمين ويدرج صفاً. التحديث والحذف بلا سياسة لذلك مرفوضان رغم وجود GRANT.

جداول authenticated فقط (anon لا تطابقه سياسة، فالـRLS يمنعه): delivery_orders، food_menu_items، food_orders، service_bookings_legacy، withdraw_requests_ledger_archive. الخطر يظهر إذا وُجد مستخدم Supabase Auth، لا من المفتاح العام وحده.

اقتراح لاحقاً: تضييق orders و users أولاً. السيرفر يتجاوز RLS فلا يتأثر مسار التطبيق الحالي.

## 4. Search path

عشر دوال كلها SECURITY INVOKER بلا search_path: block_service_bookings، driver_ledger_*، نسخة invoker من ervenow_ledger_credit والملخص، next_daily_seq، update_updated_at_column، withdraw_requests_insert_redirect.
دوال Definer الحساسة مضبوط لها search_path أصلاً. الأولوية منخفضة. الاقتراح: SET search_path TO public.

## أعلى 3 مخاطر للتنفيذ لاحقاً

1. الدلو العام وفيه 14 صورة سجل تجاري.
2. دوال اعتماد السحب وشحن الرمز وزيادة رصيد المتجر قابلة للاستدعاء من anon.
3. جدول orders وجدول users مفتوحان للمفتاح العام.

## جدول النتائج

Finding | Entity | Exposure | يستخدمه | الخطر | الإصلاح المقترح | احتمال الكسر
Public listing | erwenow-store-registrations | anon يعدد وينزّل، وفيه cr | السيرفر عند التسجيل والشعارات | Critical | دلو خاص + رابط موقّع | متوسط للروابط العامة القديمة
Definer عام | ledger_withdraw_request_approve | anon يعتمد سحباً بمعرّف | أدمن السيرفر | Critical | REVOKE عن anon/authenticated | منخفض
Definer عام | store_wallet_approve_withdrawal | anon يعتمد سحب متجر | أدمن السيرفر | Critical | نفس السحب | منخفض
Definer عام | store_wallet_credit_for_order | anon يزيد رصيداً | السيرفر | Critical | نفس السحب | منخفض
Definer عام | ervenow_redeem_topup_code | anon يشحن رمزاً لأي مستخدم | السيرفر | Critical | نفس السحب | منخفض
Definer عام | settlement_log_try_claim | anon يحجز تسوية | settlementGuard | High | نفس السحب | منخفض
Definer عام | generate_order_number | anon يستهلك أرقاماً | توليد الطلب | Medium | نفس السحب | منخفض
RLS true | orders Allow all / public | anon يقرأ ويكتب كل الطلبات | السيرفر يتجاوز RLS | Critical | سياسة أضيق أو سحب GRANT | منخفض للتطبيق
RLS true | users select+insert / public | anon يقرأ المستخدمين ويدرج | السيرفر | Critical | إلغاء select العام | منخفض للتطبيق
RLS true | delivery_orders و food_* و legacy و أرشيف السحب | authenticated فقط | غير مستخدم من المتصفح | Medium | تضييق لاحقاً | منخفض
Search path | 10 دوال invoker | ليست Definer | تريغرات وسجلات | Low | SET search_path TO public | منخفض
Definer محصور | بقية دوال ledger | service_role فقط | السيرفر | Low | لا تُمس الآن | —
