-- ERVENOW push queue for retry worker
create table if not exists public.ervenow_push_queue (
  id uuid primary key default gen_random_uuid(),

  payload jsonb,
  target_url text,

  attempts integer default 0,
  max_attempts integer default 60,

  last_error text,

  status text default 'pending',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_push_queue_status
on public.ervenow_push_queue(status);

create index if not exists idx_push_queue_created
on public.ervenow_push_queue(created_at);
