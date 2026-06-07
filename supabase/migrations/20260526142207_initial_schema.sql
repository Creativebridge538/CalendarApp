
-- Enums
create type user_role as enum ('admin', 'cast');
create type deadline_type as enum ('monthly', 'weekly');
create type shift_status as enum ('draft', 'submitted', 'confirmed', 'rejected');
create type request_status as enum ('pending', 'approved', 'rejected');

-- Stores
create table stores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- Store settings
create table store_settings (
  id                              uuid primary key default gen_random_uuid(),
  store_id                        uuid not null references stores(id) on delete cascade,
  deadline_type                   deadline_type not null default 'monthly',
  deadline_day                    int not null default 25,
  require_approval_after_deadline boolean not null default true,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique(store_id)
);

-- Users (Supabase Auth 連携)
create table public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       user_role not null default 'cast',
  store_id   uuid references stores(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Casts
create table casts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users(id) on delete set null,
  store_id     uuid not null references stores(id) on delete cascade,
  display_name text not null,
  real_name    text,
  photo_url    text,
  phone        text,
  notes        text,
  reward_rate  numeric(5,4) not null default 0.4000,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Rooms
create table rooms (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references stores(id) on delete cascade,
  name       text not null,
  capacity   int,
  notes      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Shifts
create table shifts (
  id           uuid primary key default gen_random_uuid(),
  cast_id      uuid not null references casts(id) on delete cascade,
  store_id     uuid not null references stores(id) on delete cascade,
  room_id      uuid references rooms(id) on delete set null,
  date         date not null,
  start_time   time not null,
  end_time     time not null,
  status       shift_status not null default 'draft',
  notes        text,
  confirmed_at timestamptz,
  confirmed_by uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Shift modification requests
create table shift_modification_requests (
  id             uuid primary key default gen_random_uuid(),
  shift_id       uuid not null references shifts(id) on delete cascade,
  requested_by   uuid not null references public.users(id) on delete cascade,
  new_date       date,
  new_start_time time,
  new_end_time   time,
  new_room_id    uuid references rooms(id) on delete set null,
  reason         text not null,
  status         request_status not null default 'pending',
  reviewed_by    uuid references public.users(id) on delete set null,
  reviewed_at    timestamptz,
  reject_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Vacant slots
create table vacant_slots (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references stores(id) on delete cascade,
  room_id      uuid references rooms(id) on delete set null,
  date         date not null,
  start_time   time not null,
  end_time     time not null,
  notes        text,
  is_published boolean not null default false,
  created_by   uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);

-- Vacant slot applications
create table vacant_slot_applications (
  id             uuid primary key default gen_random_uuid(),
  vacant_slot_id uuid not null references vacant_slots(id) on delete cascade,
  cast_id        uuid not null references casts(id) on delete cascade,
  status         request_status not null default 'pending',
  reviewed_by    uuid references public.users(id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique(vacant_slot_id, cast_id)
);

-- Sales
create table sales (
  id         uuid primary key default gen_random_uuid(),
  cast_id    uuid not null references casts(id) on delete cascade,
  store_id   uuid not null references stores(id) on delete cascade,
  date       date not null,
  amount     numeric(12,0) not null default 0,
  notes      text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reward calculations
create table reward_calculations (
  id            uuid primary key default gen_random_uuid(),
  cast_id       uuid not null references casts(id) on delete cascade,
  store_id      uuid not null references stores(id) on delete cascade,
  period_year   int not null,
  period_month  int not null,
  sales_total   numeric(12,0) not null default 0,
  reward_rate   numeric(5,4) not null,
  base_reward   numeric(12,0) not null default 0,
  bonus         numeric(12,0) not null default 0,
  deduction     numeric(12,0) not null default 0,
  total_reward  numeric(12,0) not null default 0,
  calculated_by uuid references public.users(id) on delete set null,
  calculated_at timestamptz not null default now(),
  is_finalized  boolean not null default false,
  unique(cast_id, period_year, period_month)
);

-- Notifications
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  store_id   uuid references stores(id) on delete cascade,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_casts_store_id on casts(store_id);
create index idx_rooms_store_id on rooms(store_id);
create index idx_shifts_cast_id on shifts(cast_id);
create index idx_shifts_store_id on shifts(store_id);
create index idx_shifts_date on shifts(date);
create index idx_shifts_status on shifts(status);
create index idx_sales_cast_id on sales(cast_id);
create index idx_sales_store_id on sales(store_id);
create index idx_sales_date on sales(date);
create index idx_notifications_user_id on notifications(user_id);
create index idx_notifications_read_at on notifications(read_at);

-- updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_store_settings_updated_at before update on store_settings   for each row execute function update_updated_at();
create trigger trg_users_updated_at          before update on public.users      for each row execute function update_updated_at();
create trigger trg_casts_updated_at          before update on casts             for each row execute function update_updated_at();
create trigger trg_shifts_updated_at         before update on shifts            for each row execute function update_updated_at();
create trigger trg_smr_updated_at            before update on shift_modification_requests for each row execute function update_updated_at();
create trigger trg_sales_updated_at          before update on sales             for each row execute function update_updated_at();

-- 新規ユーザー作成時に public.users を自動作成
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- RLS 有効化
alter table stores                      enable row level security;
alter table store_settings              enable row level security;
alter table public.users                enable row level security;
alter table casts                       enable row level security;
alter table rooms                       enable row level security;
alter table shifts                      enable row level security;
alter table shift_modification_requests enable row level security;
alter table vacant_slots                enable row level security;
alter table vacant_slot_applications    enable row level security;
alter table sales                       enable row level security;
alter table reward_calculations         enable row level security;
alter table notifications               enable row level security;

-- ヘルパー関数
create or replace function my_role()
returns user_role as $$
  select role from public.users where id = auth.uid();
$$ language sql security definer stable;

create or replace function my_store_id()
returns uuid as $$
  select store_id from public.users where id = auth.uid();
$$ language sql security definer stable;

-- RLS: stores
create policy "store: 所属ユーザーが参照可" on stores for select
  using (id = my_store_id());
create policy "store: admin が作成可" on stores for insert
  with check (my_role() = 'admin');
create policy "store: admin が更新可" on stores for update
  using (id = my_store_id() and my_role() = 'admin');

-- RLS: store_settings
create policy "store_settings: 所属ユーザーが参照可" on store_settings for select
  using (store_id = my_store_id());
create policy "store_settings: admin が全操作可" on store_settings for all
  using (store_id = my_store_id() and my_role() = 'admin');

-- RLS: users
create policy "users: 自分のレコード参照可" on public.users for select
  using (id = auth.uid());
create policy "users: admin が同店舗ユーザー参照可" on public.users for select
  using (store_id = my_store_id() and my_role() = 'admin');
create policy "users: 自分のレコード更新可" on public.users for update
  using (id = auth.uid());
create policy "users: 新規登録時 insert 許可" on public.users for insert
  with check (id = auth.uid());

-- RLS: casts
create policy "casts: admin が同店舗を全操作" on casts for all
  using (store_id = my_store_id() and my_role() = 'admin');
create policy "casts: cast が自分のレコード参照" on casts for select
  using (user_id = auth.uid());

-- RLS: rooms
create policy "rooms: admin が全操作" on rooms for all
  using (store_id = my_store_id() and my_role() = 'admin');
create policy "rooms: cast が同店舗参照" on rooms for select
  using (store_id = (select store_id from casts where user_id = auth.uid() limit 1));

-- RLS: shifts
create policy "shifts: admin が同店舗を全操作" on shifts for all
  using (store_id = my_store_id() and my_role() = 'admin');
create policy "shifts: cast が自分のシフト参照" on shifts for select
  using (cast_id in (select id from casts where user_id = auth.uid()));
create policy "shifts: cast が自分のシフト作成" on shifts for insert
  with check (cast_id in (select id from casts where user_id = auth.uid()));
create policy "shifts: cast が未確定シフト更新" on shifts for update
  using (cast_id in (select id from casts where user_id = auth.uid()) and status in ('draft', 'submitted'));

-- RLS: shift_modification_requests
create policy "smr: admin が同店舗を全操作" on shift_modification_requests for all
  using (shift_id in (select id from shifts where store_id = my_store_id()) and my_role() = 'admin');
create policy "smr: cast が自分の申請を全操作" on shift_modification_requests for all
  using (requested_by = auth.uid());

-- RLS: vacant_slots
create policy "vacant_slots: admin が全操作" on vacant_slots for all
  using (store_id = my_store_id() and my_role() = 'admin');
create policy "vacant_slots: cast が公開分を参照" on vacant_slots for select
  using (is_published = true and store_id = (select store_id from casts where user_id = auth.uid() limit 1));

-- RLS: vacant_slot_applications
create policy "vsa: admin が全操作" on vacant_slot_applications for all
  using (vacant_slot_id in (select id from vacant_slots where store_id = my_store_id()) and my_role() = 'admin');
create policy "vsa: cast が自分の申請を全操作" on vacant_slot_applications for all
  using (cast_id in (select id from casts where user_id = auth.uid()));

-- RLS: sales
create policy "sales: admin が同店舗を全操作" on sales for all
  using (store_id = my_store_id() and my_role() = 'admin');
create policy "sales: cast が自分の売上参照" on sales for select
  using (cast_id in (select id from casts where user_id = auth.uid()));

-- RLS: reward_calculations
create policy "reward: admin が同店舗を全操作" on reward_calculations for all
  using (store_id = my_store_id() and my_role() = 'admin');
create policy "reward: cast が自分の明細参照" on reward_calculations for select
  using (cast_id in (select id from casts where user_id = auth.uid()));

-- RLS: notifications
create policy "notif: 自分の通知を参照" on notifications for select
  using (user_id = auth.uid());
create policy "notif: 自分の通知を更新（既読）" on notifications for update
  using (user_id = auth.uid());
create policy "notif: insert は全員許可（サーバーサイドから）" on notifications for insert
  with check (true);
