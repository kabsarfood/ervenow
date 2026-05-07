-- ERVENOW — لقطة أرصدة للمالك: محفظة المنصة المحاسبية + مجموع محافظ التشغيل + محافظ المتاجر + سحوبات معلّقة
-- يُنفَّذ على Supabase (يفضّل بعد migration_store_wallet.sql و migration_finance_accounting.sql عند الحاجة).
-- يُستدعى من الخادم بـ service_role فقط.

create or replace function public.admin_platform_treasury_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_platform numeric := 0;
  v_erv_sum numeric := 0;
  v_store_sum numeric := 0;
  v_pending_wd numeric := 0;
  v_erv_cnt int := 0;
  v_store_cnt int := 0;
begin
  if to_regclass('public.wallets') is not null then
    select coalesce(balance, 0) into v_platform
    from public.wallets
    where owner_type = 'platform' and owner_id is null
    limit 1;
  end if;

  if to_regclass('public.ervenow_wallets') is not null then
    select coalesce(sum(balance), 0), count(*)::int into v_erv_sum, v_erv_cnt
    from public.ervenow_wallets;
  end if;

  if to_regclass('public.store_wallets') is not null then
    select coalesce(sum(balance), 0), count(*)::int into v_store_sum, v_store_cnt
    from public.store_wallets;
  end if;

  if to_regclass('public.ervenow_withdraw_requests') is not null then
    select coalesce(sum(amount), 0) into v_pending_wd
    from public.ervenow_withdraw_requests
    where lower(coalesce(status, '')) = 'pending';
  end if;

  return jsonb_build_object(
    'platform_accounting_balance', round(v_platform::numeric, 2),
    'ervenow_operational_balance_sum', round(v_erv_sum::numeric, 2),
    'store_wallets_balance_sum', round(v_store_sum::numeric, 2),
    'pending_withdraw_requests_sum', round(v_pending_wd::numeric, 2),
    'ervenow_wallets_count', v_erv_cnt,
    'store_wallets_count', v_store_cnt,
    'circulating_reference_total', round((coalesce(v_platform, 0) + coalesce(v_erv_sum, 0) + coalesce(v_store_sum, 0))::numeric, 2)
  );
end;
$$;

comment on function public.admin_platform_treasury_summary() is
  'للوحة المالك: رصيد محفظة المنصة (محاسبة) + مجموع أرصدة ervenow_wallets + مجموع store_wallets + سحوبات معلّقة.';

revoke all on function public.admin_platform_treasury_summary() from public;
grant execute on function public.admin_platform_treasury_summary() to service_role;
