-- Store wallets
create table if not exists public.store_wallets (
  id uuid primary key default gen_random_uuid(),

  store_id uuid unique references public.stores(id) on delete cascade,
  balance numeric default 0,

  created_at timestamptz default now()
);

-- Store transactions
create table if not exists public.store_transactions (
  id uuid primary key default gen_random_uuid(),

  store_id uuid references public.stores(id) on delete cascade,
  order_id uuid,

  amount numeric,
  type text, -- credit / debit

  created_at timestamptz default now()
);

-- Prevent duplicate credit for same order
create unique index if not exists idx_store_transactions_unique_order
on public.store_transactions(order_id);

-- Indexes
create index if not exists idx_store_transactions_store
on public.store_transactions(store_id);

-- Enable RLS
alter table public.store_wallets enable row level security;
alter table public.store_transactions enable row level security;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
