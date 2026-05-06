-- =============================================================================
-- دالة إيداع محفظة المتجر — store_wallet_credit_for_order
-- نفّذ بعد migration_store_wallet.sql (جداول store_wallets / store_transactions)
-- =============================================================================
-- ملاحظة: الخادم يستدعي الدالة بأربع وسائط (بما فيها p_description)؛ الوسيط الرابع اختياري.

create or replace function public.store_wallet_credit_for_order(
  p_store_id uuid,
  p_order_id uuid,
  p_amount numeric,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
begin
  if p_store_id is null or p_order_id is null or p_amount is null or p_amount <= 0 then
    return;
  end if;

  -- إنشاء محفظة إذا غير موجودة
  insert into public.store_wallets (store_id, balance)
  values (p_store_id, 0)
  on conflict (store_id) do nothing;

  -- إضافة العملية (منع التكرار عبر الفهرس الفريد على order_id)
  insert into public.store_transactions (store_id, order_id, amount, type)
  values (p_store_id, p_order_id, p_amount, 'credit')
  on conflict (order_id) do nothing;

  get diagnostics v_inserted = row_count;

  -- تحديث الرصيد فقط عند إدراج حركة جديدة (لا مضاعفة عند تكرار الاستدعاء)
  if v_inserted > 0 then
    update public.store_wallets
    set balance = balance + p_amount
    where store_id = p_store_id;
  end if;
end;
$$;

grant execute on function public.store_wallet_credit_for_order(uuid, uuid, numeric, text) to service_role;
grant execute on function public.store_wallet_credit_for_order(uuid, uuid, numeric, text) to authenticated;

-- Reload schema
notify pgrst, 'reload schema';
