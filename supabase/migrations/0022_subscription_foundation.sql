-- Phase 8.1: platform subscription plans and tenant assignment foundation.
-- Existing `subscriptions` rows remain the canonical tenant-subscription records.

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  code text not null unique check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  price numeric(14,2) not null check (price >= 0),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  duration_days integer not null check (duration_days > 0),
  max_staff integer check (max_staff is null or max_staff >= 0),
  max_products integer check (max_products is null or max_products >= 0),
  max_tables integer check (max_tables is null or max_tables >= 0),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions alter column status drop default;
alter table public.subscriptions alter column status type text using status::text;
alter table public.subscriptions alter column status set default 'ACTIVE';
alter table public.subscriptions add constraint subscriptions_status_check
  check (status in ('TRIAL', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'SUSPENDED'));
alter table public.subscriptions
  add column plan_id uuid references public.subscription_plans(id) on delete restrict,
  add column is_current boolean not null default true,
  add column updated_at timestamptz not null default now();

-- Preserve all existing records. If a tenant has historical duplicate rows,
-- only its most recently created record is designated current.
with ranked as (
  select id, row_number() over (partition by tenant_id order by created_at desc, id desc) as position
  from public.subscriptions
)
update public.subscriptions s
set is_current = (ranked.position = 1)
from ranked
where ranked.id = s.id;

update public.subscriptions
set status = 'EXPIRED', updated_at = now()
where expires_at <= now() and status <> 'SUSPENDED';

create unique index subscriptions_one_current_per_tenant
  on public.subscriptions(tenant_id) where is_current;
create index subscriptions_plan_current_idx
  on public.subscriptions(plan_id, tenant_id) where is_current;

alter table public.subscription_plans enable row level security;

grant select, insert, update on public.subscription_plans to authenticated;

create policy "platform admins manage subscription plans"
on public.subscription_plans for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "users read active or assigned subscription plans"
on public.subscription_plans for select to authenticated
using (
  is_active
  or public.is_platform_admin()
  or exists (
    select 1 from public.subscriptions s
    where s.plan_id = subscription_plans.id
      and s.tenant_id = public.current_tenant_id()
      and s.is_current
  )
);

create or replace function public.set_subscription_plan_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger subscription_plans_updated_at
before update on public.subscription_plans
for each row execute function public.set_subscription_plan_updated_at();

create trigger subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_subscription_plan_updated_at();

-- Retain the old Super Admin RPC for compatibility while keeping its legacy
-- manually entered plan as an explicitly unconfigured (unlimited) subscription.
create or replace function public.create_tenant_with_owner(
  p_owner_user_id uuid,
  p_owner_email text,
  p_owner_name text,
  p_store_name text,
  p_slug text,
  p_plan_name text,
  p_amount numeric,
  p_currency text,
  p_started_at timestamptz,
  p_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'not authorized'; end if;
  if p_expires_at <= p_started_at then raise exception 'subscription expiry must follow start'; end if;

  insert into public.tenants (name, slug)
  values (p_store_name, p_slug)
  returning id into v_tenant_id;

  insert into public.profiles (id, tenant_id, role, full_name, email)
  values (p_owner_user_id, v_tenant_id, 'STORE_OWNER', p_owner_name, p_owner_email);

  insert into public.subscriptions (
    tenant_id, plan_name, amount, currency, started_at, expires_at, status, created_by, is_current
  ) values (
    v_tenant_id,
    p_plan_name,
    p_amount,
    upper(p_currency),
    p_started_at,
    p_expires_at,
    case
      when p_expires_at <= now() then 'EXPIRED'
      when p_expires_at <= now() + interval '30 days' then 'EXPIRING_SOON'
      else 'ACTIVE'
    end,
    auth.uid(),
    true
  );

  return v_tenant_id;
end;
$$;

create or replace function public.create_tenant_with_owner_plan(
  p_owner_user_id uuid,
  p_owner_email text,
  p_owner_name text,
  p_store_name text,
  p_slug text,
  p_plan_id uuid,
  p_started_at timestamptz,
  p_is_trial boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant_id uuid;
  v_plan public.subscription_plans%rowtype;
  v_expires_at timestamptz;
begin
  if not public.is_platform_admin() then raise exception 'not authorized'; end if;
  if p_started_at is null then raise exception 'subscription start is required'; end if;

  select * into v_plan
  from public.subscription_plans
  where id = p_plan_id and is_active
  for share;
  if not found then raise exception 'subscription plan unavailable'; end if;

  v_expires_at := p_started_at + make_interval(days => v_plan.duration_days);

  insert into public.tenants (name, slug)
  values (p_store_name, p_slug)
  returning id into v_tenant_id;

  insert into public.profiles (id, tenant_id, role, full_name, email)
  values (p_owner_user_id, v_tenant_id, 'STORE_OWNER', p_owner_name, p_owner_email);

  insert into public.subscriptions (
    tenant_id, plan_id, plan_name, amount, currency, started_at, expires_at,
    status, created_by, is_current
  ) values (
    v_tenant_id, v_plan.id, v_plan.name, v_plan.price, v_plan.currency,
    p_started_at, v_expires_at,
    case when coalesce(p_is_trial, false) then 'TRIAL' else 'ACTIVE' end,
    auth.uid(), true
  );

  return v_tenant_id;
end;
$$;

create or replace function public.assign_tenant_subscription(
  p_tenant_id uuid,
  p_plan_id uuid,
  p_status text,
  p_started_at timestamptz
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_subscription_id uuid;
  v_expires_at timestamptz;
  v_status text := upper(trim(coalesce(p_status, '')));
begin
  if not public.is_platform_admin() then raise exception 'not authorized'; end if;
  if v_status not in ('TRIAL', 'ACTIVE', 'SUSPENDED') then raise exception 'invalid subscription status'; end if;
  if p_started_at is null then raise exception 'subscription start is required'; end if;

  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'tenant not found'; end if;

  select * into v_plan
  from public.subscription_plans
  where id = p_plan_id and is_active
  for share;
  if not found then raise exception 'subscription plan unavailable'; end if;

  v_expires_at := p_started_at + make_interval(days => v_plan.duration_days);
  update public.subscriptions set is_current = false, updated_at = now()
  where tenant_id = p_tenant_id and is_current;

  insert into public.subscriptions (
    tenant_id, plan_id, plan_name, amount, currency, started_at, expires_at,
    status, created_by, is_current
  ) values (
    p_tenant_id, v_plan.id, v_plan.name, v_plan.price, v_plan.currency,
    p_started_at, v_expires_at, v_status, auth.uid(), true
  ) returning id into v_subscription_id;

  return v_subscription_id;
end;
$$;

revoke all on function public.create_tenant_with_owner_plan(uuid, text, text, text, text, uuid, timestamptz, boolean) from public;
grant execute on function public.create_tenant_with_owner_plan(uuid, text, text, text, text, uuid, timestamptz, boolean) to authenticated;
revoke all on function public.assign_tenant_subscription(uuid, uuid, text, timestamptz) from public;
grant execute on function public.assign_tenant_subscription(uuid, uuid, text, timestamptz) to authenticated;

comment on column public.subscription_plans.max_staff is 'NULL means explicitly unlimited.';
comment on column public.subscription_plans.max_products is 'NULL means explicitly unlimited.';
comment on column public.subscription_plans.max_tables is 'NULL means explicitly unlimited.';
comment on column public.subscriptions.is_current is 'At most one current subscription per tenant; older rows are retained as history.';
comment on column public.subscriptions.plan_id is 'NULL is a legacy/unconfigured subscription; existing tenant access is not blocked and no new limits are inferred.';
