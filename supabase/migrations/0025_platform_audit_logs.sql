-- Phase 8.4: immutable, platform-admin-readable audit history for platform changes.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_role text not null,
  action text not null check (action in (
    'TENANT_CREATED', 'TENANT_UPDATED', 'PLAN_CREATED', 'PLAN_UPDATED',
    'SUBSCRIPTION_ASSIGNED', 'SUBSCRIPTION_UPDATED', 'SUBSCRIPTION_SUSPENDED', 'SUBSCRIPTION_ACTIVATED'
  )),
  entity_type text not null check (entity_type in ('TENANT', 'SUBSCRIPTION_PLAN', 'SUBSCRIPTION')),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_logs_created_at_idx on public.audit_logs(created_at desc);
create index audit_logs_tenant_created_idx on public.audit_logs(tenant_id, created_at desc);
create index audit_logs_action_created_idx on public.audit_logs(action, created_at desc);

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from public, anon, authenticated;
grant select on public.audit_logs to authenticated;
create policy "platform admins read audit logs"
on public.audit_logs for select to authenticated
using (public.is_platform_admin());

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
  if p_actor_id is null then raise exception 'audit actor is required'; end if;
  select role::text into v_actor_role from public.profiles where id = p_actor_id;
  if v_actor_role is null then raise exception 'audit actor profile not found'; end if;

  insert into public.audit_logs(tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, metadata)
  values (p_tenant_id, p_actor_id, v_actor_role, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create or replace function public.audit_tenant_platform_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_platform_audit_log(null, auth.uid(), 'TENANT_CREATED', 'TENANT', new.id,
      jsonb_build_object('name', new.name, 'slug', new.slug, 'status', new.status::text));
  elsif new.status is distinct from old.status then
    perform public.write_platform_audit_log(null, auth.uid(), 'TENANT_UPDATED', 'TENANT', new.id,
      jsonb_build_object('name', new.name, 'slug', new.slug, 'status', new.status::text));
  end if;
  return new;
end;
$$;

create or replace function public.audit_subscription_plan_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_action text;
begin
  v_action := case when tg_op = 'INSERT' then 'PLAN_CREATED' else 'PLAN_UPDATED' end;
  perform public.write_platform_audit_log(null, auth.uid(), v_action, 'SUBSCRIPTION_PLAN', new.id,
    jsonb_build_object('name', new.name, 'code', new.code, 'price', new.price, 'currency', new.currency,
      'duration_days', new.duration_days, 'max_staff', new.max_staff, 'max_products', new.max_products,
      'max_tables', new.max_tables, 'is_active', new.is_active));
  return new;
end;
$$;

create or replace function public.audit_tenant_subscription_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'SUSPENDED' then
      v_action := 'SUBSCRIPTION_SUSPENDED';
    elsif new.status in ('ACTIVE', 'TRIAL') and exists (
      select 1 from public.subscriptions previous
      where previous.tenant_id = new.tenant_id and not previous.is_current and previous.status = 'SUSPENDED'
    ) then
      v_action := 'SUBSCRIPTION_ACTIVATED';
    else
      v_action := 'SUBSCRIPTION_ASSIGNED';
    end if;
  elsif new.status is distinct from old.status and new.status = 'SUSPENDED' then
    v_action := 'SUBSCRIPTION_SUSPENDED';
  elsif new.status is distinct from old.status and old.status = 'SUSPENDED' and new.status in ('ACTIVE', 'TRIAL') then
    v_action := 'SUBSCRIPTION_ACTIVATED';
  else
    v_action := 'SUBSCRIPTION_UPDATED';
  end if;
  perform public.write_platform_audit_log(new.tenant_id, auth.uid(), v_action, 'SUBSCRIPTION', new.id,
    jsonb_build_object('plan_name', new.plan_name, 'plan_id', new.plan_id, 'amount', new.amount,
      'currency', new.currency, 'status', new.status, 'starts_at', new.started_at,
      'expires_at', new.expires_at, 'is_current', new.is_current));
  return new;
end;
$$;

create trigger tenants_platform_audit
after insert or update on public.tenants
for each row execute function public.audit_tenant_platform_change();
create trigger subscription_plans_platform_audit
after insert or update on public.subscription_plans
for each row execute function public.audit_subscription_plan_change();
create trigger subscriptions_platform_audit
after insert or update on public.subscriptions
for each row execute function public.audit_tenant_subscription_change();

revoke all on function public.write_platform_audit_log(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.audit_tenant_platform_change() from public, anon, authenticated;
revoke all on function public.audit_subscription_plan_change() from public, anon, authenticated;
revoke all on function public.audit_tenant_subscription_change() from public, anon, authenticated;

comment on table public.audit_logs is 'Append-only platform action history. Writes occur transactionally through database triggers; only SUPER_ADMIN can read.';
