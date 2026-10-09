-- Phase 8.2: transaction-safe tenant resource caps.
-- The tenant row is the per-tenant mutex shared by all three resource types.

create or replace function public.enforce_subscription_resource_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid := new.tenant_id;
  v_resource text;
  v_plan_code text;
  v_limit integer;
  v_usage bigint;
  v_new_counted boolean := false;
  v_old_counted boolean := false;
  v_exclude_id uuid;
begin
  if tg_table_name = 'profiles' then
    v_resource := 'STAFF';
    v_new_counted := new.role in ('CASHIER', 'KITCHEN_ADMIN') and new.is_active;
    if tg_op = 'UPDATE' then
      v_old_counted := old.role in ('CASHIER', 'KITCHEN_ADMIN') and old.is_active;
      if v_old_counted then v_exclude_id := old.id; end if;
    end if;
    if not v_new_counted then return new; end if;
    if public.current_profile_role() <> 'STORE_OWNER'
      or public.current_tenant_id() is distinct from v_tenant_id then
      raise exception 'not authorized';
    end if;
  elsif tg_table_name = 'products' then
    v_resource := 'PRODUCTS';
    v_new_counted := new.is_active;
    if tg_op = 'UPDATE' then
      v_old_counted := old.is_active;
      if v_old_counted then v_exclude_id := old.id; end if;
    end if;
    if not v_new_counted then return new; end if;
    if public.current_profile_role() <> 'STORE_OWNER'
      or public.current_tenant_id() is distinct from v_tenant_id then
      raise exception 'not authorized';
    end if;
  elsif tg_table_name = 'tables' then
    v_resource := 'TABLES';
    v_new_counted := new.status = 'ACTIVE';
    if tg_op = 'UPDATE' then
      v_old_counted := old.status = 'ACTIVE';
      if v_old_counted then v_exclude_id := old.id; end if;
    end if;
    if not v_new_counted then return new; end if;
    if public.current_profile_role() <> 'STORE_OWNER'
      or public.current_tenant_id() is distinct from v_tenant_id then
      raise exception 'not authorized';
    end if;
  else
    raise exception 'unsupported subscription-limited resource';
  end if;

  -- Edits to already-counted rows do not consume another slot.
  if tg_op = 'UPDATE' and v_old_counted and old.tenant_id = v_tenant_id then
    return new;
  end if;

  perform 1 from public.tenants where id = v_tenant_id for update;
  if not found then raise exception 'tenant not found'; end if;

  select p.code,
    case v_resource
      when 'STAFF' then p.max_staff
      when 'PRODUCTS' then p.max_products
      when 'TABLES' then p.max_tables
    end
  into v_plan_code, v_limit
  from public.subscriptions s
  join public.subscription_plans p on p.id = s.plan_id
  where s.tenant_id = v_tenant_id and s.is_current
  for share of p;

  -- Existing subscriptions without a plan are legacy/unconfigured and remain
  -- usable without an inferred cap until Super Admin assigns a plan.
  if not found or v_limit is null then return new; end if;

  if v_resource = 'STAFF' then
    select count(*) into v_usage from public.profiles
    where tenant_id = v_tenant_id
      and role in ('CASHIER', 'KITCHEN_ADMIN')
      and is_active
      and (v_exclude_id is null or id <> v_exclude_id);
  elsif v_resource = 'PRODUCTS' then
    select count(*) into v_usage from public.products
    where tenant_id = v_tenant_id and is_active
      and (v_exclude_id is null or id <> v_exclude_id);
  else
    select count(*) into v_usage from public.tables
    where tenant_id = v_tenant_id and status = 'ACTIVE'
      and (v_exclude_id is null or id <> v_exclude_id);
  end if;

  if v_usage >= v_limit then
    raise exception using
      errcode = 'P0001',
      message = format('PLAN_LIMIT:%s:%s:%s', v_resource, v_plan_code, v_limit);
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_subscription_resource_limit() from public, anon, authenticated;

create trigger profiles_subscription_staff_limit
before insert or update on public.profiles
for each row execute function public.enforce_subscription_resource_limit();

create trigger products_subscription_limit
before insert or update on public.products
for each row execute function public.enforce_subscription_resource_limit();

create trigger tables_subscription_limit
before insert or update on public.tables
for each row execute function public.enforce_subscription_resource_limit();

comment on function public.enforce_subscription_resource_limit() is
'Serializes active staff/product/table usage checks per tenant and rejects over-limit writes. NULL plan limits mean unlimited; missing legacy plans do not block existing tenant operations.';
