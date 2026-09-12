-- ============================================================
-- SwiftDeliver — Supabase schema
-- Run this whole file once in Supabase SQL Editor
-- ============================================================

-- Profiles table: extends Supabase's built-in auth.users
-- with the app-specific fields (role, agent link, etc.)
create table if not exists profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  name text not null,
  email text not null,
  role text not null default 'user' check (role in ('user','sender','receiver','agent','admin')),
  agent_id text,
  phone text,
  address text,
  created_at timestamptz default now()
);

-- Agents table (couriers)
create table if not exists agents (
  id text primary key,
  name text not null,
  phone text,
  rating numeric default 5,
  deliveries integer default 0
);

-- Deliveries table — the whole delivery object (code, items,
-- addresses, status, timeline, cod, insurance, promo, rating,
-- everything the app already uses) is stored as JSONB in `data`.
-- This keeps every existing field working without needing a
-- column for each one, and matches the app's existing shape.
create table if not exists deliveries (
  id text primary key,
  sender_id uuid references auth.users(id),
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists deliveries_sender_idx on deliveries(sender_id);

-- Disputes / support cases — same JSONB-blob pattern as deliveries
create table if not exists disputes (
  id text primary key,
  user_id uuid references auth.users(id),
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists disputes_user_idx on disputes(user_id);

-- ── Row Level Security ──────────────────────────────────────
alter table profiles enable row level security;
alter table deliveries enable row level security;
alter table agents enable row level security;

-- Profiles: readable by any logged-in user (needed for admin user
-- list, and to show sender/agent names); only editable by owner
create policy "profiles are viewable by authenticated users"
  on profiles for select to authenticated using (true);
create policy "users can insert their own profile"
  on profiles for insert to authenticated with check (auth.uid() = id);
create policy "users can update their own profile"
  on profiles for update to authenticated using (auth.uid() = id);

-- Deliveries: any authenticated user can read/write for now
-- (tighten later once you want sender/agent/admin-only rules)
create policy "authenticated users can read deliveries"
  on deliveries for select to authenticated using (true);
create policy "authenticated users can insert deliveries"
  on deliveries for insert to authenticated with check (true);
create policy "authenticated users can update deliveries"
  on deliveries for update to authenticated using (true);
create policy "authenticated users can delete deliveries"
  on deliveries for delete to authenticated using (true);

-- Agents: readable by everyone logged in
create policy "authenticated users can read agents"
  on agents for select to authenticated using (true);

-- Disputes: authenticated users can read/write for now
create policy "authenticated users can read disputes"
  on disputes for select to authenticated using (true);
create policy "authenticated users can insert disputes"
  on disputes for insert to authenticated with check (true);
create policy "authenticated users can update disputes"
  on disputes for update to authenticated using (true);

-- Seed the 4 demo agents
insert into agents (id, name, phone, rating, deliveries) values
  ('ag1', 'Ravi Kumar', '+91 98001 11001', 4.8, 312),
  ('ag2', 'Priya Sharma', '+91 98001 22002', 4.9, 488),
  ('ag3', 'Arjun Singh', '+91 98001 33003', 4.7, 197),
  ('ag4', 'Meena Patel', '+91 98001 44004', 4.6, 254)
on conflict (id) do nothing;

-- Auto-create a profile row whenever someone signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'user')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
