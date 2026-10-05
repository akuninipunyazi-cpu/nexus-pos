create extension if not exists "pgcrypto";

create type public.app_role as enum ('SUPER_ADMIN', 'STORE_OWNER', 'CASHIER', 'KITCHEN_ADMIN');
create type public.tenant_status as enum ('ACTIVE', 'INACTIVE');
create type public.subscription_status as enum ('ACTIVE', 'EXPIRING_SOON', 'EXPIRED');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status public.tenant_status not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete restrict,
  role public.app_role not null,
  full_name text,
  email text not null,
  created_at timestamptz not null default now(),
  constraint platform_profile_has_no_tenant check ((role = 'SUPER_ADMIN' and tenant_id is null) or (role <> 'SUPER_ADMIN' and tenant_id is not null))
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_name text not null,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null check (char_length(currency) between 3 and 3),
  started_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > started_at),
  status public.subscription_status not null default 'ACTIVE',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.subscription_revenue_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null check (char_length(currency) between 3 and 3),
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  reference text
);

create or replace function public.current_profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select tenant_id from public.profiles where id = auth.uid() $$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN') $$;

revoke all on function public.current_profile_role() from public;
revoke all on function public.current_tenant_id() from public;
revoke all on function public.is_platform_admin() from public;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_revenue_records enable row level security;

create policy "platform admins manage tenants"
on public.tenants for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "tenant users read own tenant"
on public.tenants for select to authenticated
using (id = public.current_tenant_id());

create policy "users can read own profile"
on public.profiles for select to authenticated
using (id = auth.uid());

create policy "platform admins manage profiles"
on public.profiles for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "owners can read tenant profiles"
on public.profiles for select to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'STORE_OWNER');

create policy "platform admins manage subscriptions"
on public.subscriptions for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "tenant users read own subscriptions"
on public.subscriptions for select to authenticated
using (tenant_id = public.current_tenant_id());

create policy "platform admins manage revenue records"
on public.subscription_revenue_records for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create index profiles_tenant_id_idx on public.profiles(tenant_id);
create index subscriptions_tenant_id_idx on public.subscriptions(tenant_id);
create index subscription_revenue_tenant_id_idx on public.subscription_revenue_records(tenant_id);
