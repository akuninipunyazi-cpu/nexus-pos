-- Phase 9.1: public plan display and self-service subscription checkout.
-- Tenants and active subscriptions are created only after verified Midtrans payment.

create table public.subscription_orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique check (char_length(order_id) between 1 and 50),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  owner_name text not null check (char_length(trim(owner_name)) between 1 and 120),
  store_name text not null check (char_length(trim(store_name)) between 1 and 120),
  store_slug text not null check (store_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  plan_name text not null,
  duration_days integer not null check (duration_days > 0),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payment_status text not null default 'PENDING'
    check (payment_status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED')),
  tenant_id uuid references public.tenants(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  midtrans_transaction_id text,
  midtrans_payment_type text,
  snap_token text,
  snap_redirect_url text,
  snap_create_claimed_at timestamptz,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_orders_paid_consistency check (
    (payment_status = 'PAID' and tenant_id is not null and subscription_id is not null and paid_at is not null)
    or
    (payment_status <> 'PAID' and tenant_id is null and subscription_id is null and paid_at is null)
  )
);

create unique index subscription_orders_one_pending_per_user
  on public.subscription_orders(owner_user_id) where payment_status = 'PENDING';
create unique index subscription_orders_one_pending_slug
  on public.subscription_orders(store_slug) where payment_status = 'PENDING';
create unique index subscription_orders_midtrans_transaction_unique
  on public.subscription_orders(midtrans_transaction_id) where midtrans_transaction_id is not null;
create index subscription_orders_owner_created_idx
  on public.subscription_orders(owner_user_id, created_at desc);
create index subscription_orders_tenant_idx
  on public.subscription_orders(tenant_id) where tenant_id is not null;

alter table public.subscription_orders enable row level security;
revoke all on public.subscription_orders from public, anon, authenticated;
grant select (
  id, order_id, owner_user_id, owner_name, store_name, store_slug,
  plan_id, plan_name, amount, currency, payment_status, tenant_id,
  subscription_id, midtrans_transaction_id, midtrans_payment_type,
  expires_at, paid_at, created_at, updated_at
) on public.subscription_orders to authenticated;
grant all on public.subscription_orders to service_role;

create policy "users read own subscription checkout"
on public.subscription_orders for select to authenticated
using (owner_user_id = auth.uid());

create or replace function public.get_public_subscription_plans()
returns table (
  id uuid,
  name text,
  code text,
  price numeric,
  currency text,
  duration_days integer,
  max_staff integer,
  max_products integer,
  max_tables integer,
  can_checkout boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.name, p.code, p.price, p.currency, p.duration_days,
         p.max_staff, p.max_products, p.max_tables,
         (p.currency = 'IDR' and p.price > 0 and p.price = trunc(p.price)
           and p.price <= 9007199254740991)
  from public.subscription_plans p
  where p.is_active
  order by p.price, p.duration_days, p.name;
$$;

create or replace function public.prevent_subscription_plan_change_during_checkout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.subscription_orders o
    where o.plan_id = old.id and o.payment_status = 'PENDING' and o.expires_at > now()
  ) then
    raise exception 'plan has a pending subscription checkout';
  end if;
  return new;
end;
$$;

create trigger subscription_plan_pending_checkout_guard
before update on public.subscription_plans
for each row execute function public.prevent_subscription_plan_change_during_checkout();

create or replace function public.create_self_service_subscription_order(
  p_plan_code text,
  p_owner_name text,
  p_store_name text,
  p_expected_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_plan public.subscription_plans%rowtype;
  v_existing public.subscription_orders%rowtype;
  v_order public.subscription_orders%rowtype;
  v_base_slug text;
  v_slug text;
  v_order_id text;
begin
  if v_user_id is null or auth.role() <> 'authenticated' then
    raise exception 'authenticated account required';
  end if;
  if p_plan_code is null or p_plan_code !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid subscription plan';
  end if;
  if p_owner_name is null or char_length(trim(p_owner_name)) not between 1 and 120 then
    raise exception 'owner name is required';
  end if;
  if p_store_name is null or char_length(trim(p_store_name)) not between 1 and 120 then
    raise exception 'store name is required';
  end if;

  select u.email, u.email_confirmed_at
  into v_email, v_email_confirmed_at
  from auth.users u
  where u.id = v_user_id;
  if v_email is null or v_email_confirmed_at is null then
    raise exception 'verified email required';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_user_id) then
    raise exception 'this account already has an assigned workspace';
  end if;

  -- Serialize first-time checkout creation for this account. The unique
  -- partial index remains a final integrity guard.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 9102));

  select * into v_plan
  from public.subscription_plans p
  where p.code = p_plan_code and p.is_active
  for share;
  if not found then raise exception 'subscription plan unavailable'; end if;
  if v_plan.currency <> 'IDR' or v_plan.price <= 0
    or v_plan.price <> trunc(v_plan.price)
    or v_plan.price > 9007199254740991 then
    raise exception 'this plan is not available for online checkout';
  end if;
  if p_expected_amount is null or p_expected_amount <> v_plan.price then
    raise exception 'plan price changed; reload the selected package';
  end if;

  select * into v_existing
  from public.subscription_orders o
  where o.owner_user_id = v_user_id
    and (
      o.payment_status = 'PENDING'
      or (o.payment_status = 'FAILED' and o.snap_token is not null and o.expires_at > now())
    )
  order by o.created_at desc
  limit 1
  for update;
  if found then
    if v_existing.expires_at <= now()
      or (v_existing.snap_token is null and v_existing.created_at < now() - interval '5 minutes') then
      update public.subscription_orders
      set payment_status = case when expires_at <= now() then 'EXPIRED' else 'FAILED' end,
          updated_at = now()
      where id = v_existing.id;
    elsif v_existing.plan_id = v_plan.id
      and v_existing.owner_name = trim(p_owner_name)
      and v_existing.store_name = trim(p_store_name)
      and v_existing.snap_token is not null
      and v_existing.snap_redirect_url is not null then
      return jsonb_build_object(
        'order_id', v_existing.order_id,
        'plan_name', v_existing.plan_name,
        'amount', v_existing.amount,
        'duration_days', v_existing.duration_days,
        'currency', v_existing.currency,
        'expires_at', v_existing.expires_at,
        'payment_status', v_existing.payment_status,
        'reused', true
      );
    else
      raise exception 'an unfinished checkout already exists for this account';
    end if;
  end if;

  v_base_slug := lower(trim(both '-' from regexp_replace(trim(p_store_name), '[^a-zA-Z0-9]+', '-', 'g')));
  if v_base_slug = '' then v_base_slug := 'coffee-shop'; end if;
  v_base_slug := left(v_base_slug, 75);
  loop
    v_slug := v_base_slug || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8);
    exit when not exists (select 1 from public.tenants t where t.slug = v_slug)
      and not exists (
        select 1 from public.subscription_orders o
        where o.store_slug = v_slug and o.payment_status = 'PENDING'
      );
  end loop;
  v_order_id := 'PCSUB-' || upper(replace(gen_random_uuid()::text, '-', ''));

  insert into public.subscription_orders (
    order_id, owner_user_id, owner_name, store_name, store_slug,
    plan_id, plan_name, duration_days, amount, currency, expires_at
  ) values (
    v_order_id, v_user_id, trim(p_owner_name), trim(p_store_name), v_slug,
    v_plan.id, v_plan.name, v_plan.duration_days, v_plan.price, v_plan.currency, now() + interval '1 day'
  )
  returning * into v_order;

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'plan_name', v_order.plan_name,
    'amount', v_order.amount,
    'duration_days', v_order.duration_days,
    'currency', v_order.currency,
    'expires_at', v_order.expires_at,
    'reused', false
  );
end;
$$;

create or replace function public.claim_subscription_snap_checkout(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.subscription_orders%rowtype;
begin
  if auth.uid() is null or auth.role() <> 'authenticated' then
    raise exception 'authenticated account required';
  end if;

  select * into v_order
  from public.subscription_orders o
  where o.order_id = p_order_id and o.owner_user_id = auth.uid()
  for update;
  if not found or v_order.payment_status not in ('PENDING', 'FAILED') or v_order.expires_at <= now()
    or (v_order.payment_status = 'FAILED' and v_order.snap_token is null) then
    raise exception 'checkout is unavailable';
  end if;

  if v_order.snap_token is not null and v_order.snap_redirect_url is not null then
    return jsonb_build_object(
      'state', 'READY',
      'snap_token', v_order.snap_token,
      'redirect_url', v_order.snap_redirect_url
    );
  end if;

  if v_order.snap_create_claimed_at is not null
    and v_order.snap_create_claimed_at > now() - interval '2 minutes' then
    return jsonb_build_object('state', 'PROCESSING');
  end if;

  update public.subscription_orders
  set snap_create_claimed_at = now(), updated_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'state', 'CLAIMED',
    'order_id', v_order.order_id,
    'amount', v_order.amount,
    'currency', v_order.currency,
    'plan_name', v_order.plan_name,
    'owner_name', v_order.owner_name
  );
end;
$$;

create or replace function public.complete_subscription_snap_checkout(
  p_order_id text,
  p_snap_token text,
  p_redirect_url text,
  p_transaction_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'not authorized'; end if;
  if p_order_id is null or p_snap_token is null or char_length(p_snap_token) > 2048
    or p_redirect_url is null or char_length(p_redirect_url) > 2048 then
    raise exception 'invalid checkout response';
  end if;

  update public.subscription_orders
  set snap_token = p_snap_token,
      snap_redirect_url = p_redirect_url,
      midtrans_transaction_id = coalesce(p_transaction_id, midtrans_transaction_id),
      snap_create_claimed_at = null,
      updated_at = now()
  where order_id = p_order_id
    and payment_status = 'PENDING'
    and expires_at > now()
    and snap_token is null
    and snap_create_claimed_at > now() - interval '2 minutes';

  return found;
end;
$$;

create or replace function public.release_subscription_snap_checkout(p_order_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'not authorized'; end if;
  update public.subscription_orders
  set snap_create_claimed_at = null, updated_at = now()
  where order_id = p_order_id and payment_status = 'PENDING' and snap_token is null;
end;
$$;

-- Midtrans notifications are verified in the server route before this
-- service-role-only transactional function is called.
create or replace function public.apply_verified_subscription_payment(
  p_order_id text,
  p_transaction_id text,
  p_payment_type text,
  p_payment_status text,
  p_amount numeric,
  p_currency text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.subscription_orders%rowtype;
  v_user_email text;
  v_plan public.subscription_plans%rowtype;
  v_tenant_id uuid;
  v_subscription_id uuid;
  v_expires_at timestamptz;
  v_slug text;
  v_base_slug text;
begin
  if auth.role() <> 'service_role' then raise exception 'not authorized'; end if;
  if p_order_id is null or char_length(p_order_id) > 50
    or p_transaction_id is null or p_payment_type is null
    or p_payment_status not in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED')
    or p_amount is null or p_currency is null then
    raise exception 'invalid verified payment data';
  end if;

  select * into v_order
  from public.subscription_orders o
  where o.order_id = p_order_id
  for update;
  if not found then raise exception 'subscription order not found'; end if;
  if v_order.amount <> p_amount or v_order.currency <> upper(p_currency) then
    raise exception 'payment amount or currency mismatch';
  end if;

  if v_order.payment_status = 'PAID' then
    if v_order.midtrans_transaction_id is distinct from p_transaction_id then
      raise exception 'transaction does not match completed payment';
    end if;
    return 'PAID';
  end if;

  -- Snap can permit another attempt after a declined payment. If Midtrans's
  -- authoritative status later reports settlement, allow that verified retry.
  if v_order.payment_status = 'FAILED' and p_payment_status = 'PAID' then
    null;
  elsif v_order.payment_status = 'FAILED' and p_payment_status in ('EXPIRED', 'CANCELLED') then
    update public.subscription_orders
    set payment_status = p_payment_status,
        midtrans_transaction_id = p_transaction_id,
        midtrans_payment_type = p_payment_type,
        updated_at = now()
    where id = v_order.id;
    return p_payment_status;
  elsif v_order.payment_status <> 'PENDING' then
    if v_order.payment_status = p_payment_status then return v_order.payment_status; end if;
    if p_payment_status = 'PENDING' then return v_order.payment_status; end if;
    raise exception 'invalid payment state transition';
  end if;

  if p_payment_status <> 'PAID' then
    update public.subscription_orders
    set payment_status = p_payment_status,
        midtrans_transaction_id = p_transaction_id,
        midtrans_payment_type = p_payment_type,
        updated_at = now()
    where id = v_order.id;
    return p_payment_status;
  end if;

  select u.email into v_user_email
  from auth.users u
  where u.id = v_order.owner_user_id and u.email_confirmed_at is not null;
  if v_user_email is null then raise exception 'verified owner account not found'; end if;
  if exists (select 1 from public.profiles p where p.id = v_order.owner_user_id) then
    raise exception 'owner account already has a workspace';
  end if;

  select * into v_plan
  from public.subscription_plans p
  where p.id = v_order.plan_id
  for share;
  if not found then raise exception 'subscription plan not found'; end if;

  v_base_slug := v_order.store_slug;
  v_slug := v_base_slug;
  while exists (select 1 from public.tenants t where t.slug = v_slug) loop
    v_slug := left(v_base_slug, 100) || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8);
  end loop;

  insert into public.tenants (name, slug, status)
  values (v_order.store_name, v_slug, 'ACTIVE')
  returning id into v_tenant_id;

  insert into public.profiles (id, tenant_id, role, full_name, email, is_active)
  values (v_order.owner_user_id, v_tenant_id, 'STORE_OWNER', v_order.owner_name, lower(v_user_email), true);

  v_expires_at := now() + make_interval(days => v_order.duration_days);
  insert into public.subscriptions (
    tenant_id, plan_id, plan_name, amount, currency, started_at, expires_at,
    status, created_by, is_current
  ) values (
    v_tenant_id, v_order.plan_id, v_order.plan_name, v_order.amount, v_order.currency,
    now(), v_expires_at, 'ACTIVE', v_order.owner_user_id, true
  ) returning id into v_subscription_id;

  update public.subscription_orders
  set payment_status = 'PAID',
      tenant_id = v_tenant_id,
      subscription_id = v_subscription_id,
      midtrans_transaction_id = p_transaction_id,
      midtrans_payment_type = p_payment_type,
      paid_at = now(),
      updated_at = now()
  where id = v_order.id;

  return 'PAID';
end;
$$;

-- The normal platform audit writer requires a profile actor. A verified
-- payment webhook has no interactive user session, so record it explicitly
-- as SYSTEM while keeping all ordinary user actor checks unchanged.
create or replace function public.write_platform_audit_log(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
begin
  if p_actor_id is null then
    if auth.role() <> 'service_role' then raise exception 'audit actor is required'; end if;
    v_actor_role := 'SYSTEM';
  else
    select role::text into v_actor_role from public.profiles where id = p_actor_id;
    if v_actor_role is null then raise exception 'audit actor profile not found'; end if;
  end if;

  insert into public.audit_logs(tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, metadata)
  values (p_tenant_id, p_actor_id, v_actor_role, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.get_public_subscription_plans() from public;
grant execute on function public.get_public_subscription_plans() to anon, authenticated;
revoke all on function public.prevent_subscription_plan_change_during_checkout() from public, anon, authenticated;
revoke all on function public.create_self_service_subscription_order(text, text, text, numeric) from public, anon;
grant execute on function public.create_self_service_subscription_order(text, text, text, numeric) to authenticated;
revoke all on function public.claim_subscription_snap_checkout(text) from public, anon;
grant execute on function public.claim_subscription_snap_checkout(text) to authenticated;
revoke all on function public.complete_subscription_snap_checkout(text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_subscription_snap_checkout(text, text, text, text) to service_role;
revoke all on function public.release_subscription_snap_checkout(text) from public, anon, authenticated;
grant execute on function public.release_subscription_snap_checkout(text) to service_role;
revoke all on function public.apply_verified_subscription_payment(text, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.apply_verified_subscription_payment(text, text, text, text, numeric, text) to service_role;
revoke all on function public.write_platform_audit_log(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.write_platform_audit_log(uuid, uuid, text, text, uuid, jsonb) to service_role;

comment on table public.subscription_orders is
  'Pending self-service SaaS subscription checkouts. Tenant/profile/subscription creation is transactional and occurs only after verified Midtrans payment.';
comment on function public.apply_verified_subscription_payment(text, text, text, text, numeric, text) is
  'Service-role only. Called by the server after Midtrans signature and status verification; idempotently activates one owner tenant and subscription.';
comment on function public.create_self_service_subscription_order(text, text, text, numeric) is
  'Creates a pending checkout with server-read plan price and duration. Expected price is only a stale-page precondition, never the charged amount.';
comment on function public.claim_subscription_snap_checkout(text) is
  'Authenticated owner-only atomic claim prevents concurrent requests from creating multiple Snap checkouts for one subscription order.';
