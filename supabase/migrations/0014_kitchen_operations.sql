alter table public.orders
  add column if not exists queued_at timestamptz,
  add column if not exists preparing_at timestamptz,
  add column if not exists ready_at timestamptz,
  add column if not exists completed_at timestamptz;

create or replace function public.set_order_state_timestamps()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.order_status = 'QUEUED' and old.order_status is distinct from new.order_status then
    new.queued_at := coalesce(new.queued_at, now());
  elsif new.order_status = 'PREPARING' and old.order_status is distinct from new.order_status then
    new.preparing_at := coalesce(new.preparing_at, now());
  elsif new.order_status = 'READY' and old.order_status is distinct from new.order_status then
    new.ready_at := coalesce(new.ready_at, now());
  elsif new.order_status = 'COMPLETED' and old.order_status is distinct from new.order_status then
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists orders_state_timestamps on public.orders;
create trigger orders_state_timestamps
before update of order_status on public.orders
for each row execute function public.set_order_state_timestamps();

grant select on public.orders, public.order_items, public.tables to authenticated;

create policy "kitchen admins read tenant orders"
on public.orders for select to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'KITCHEN_ADMIN');

create policy "kitchen admins read tenant order items"
on public.order_items for select to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'KITCHEN_ADMIN');

create policy "kitchen admins read tenant tables"
on public.tables for select to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'KITCHEN_ADMIN');

create index if not exists orders_kitchen_queue_idx
  on public.orders (tenant_id, order_status, queued_at desc, created_at desc);

create or replace function public.transition_kitchen_order(
  p_order_id uuid,
  p_next_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role text := public.current_profile_role()::text;
  v_current_status text;
  v_payment_status text;
  v_updated integer;
begin
  if v_role <> 'KITCHEN_ADMIN' or v_tenant_id is null then
    raise exception 'not authorized';
  end if;

  if p_next_status not in ('PREPARING', 'READY', 'COMPLETED') then
    raise exception 'invalid kitchen status';
  end if;

  select order_status, payment_status
    into v_current_status, v_payment_status
    from public.orders
   where id = p_order_id and tenant_id = v_tenant_id
   for update;

  if not found then
    raise exception 'order not found';
  end if;

  if v_current_status = p_next_status then
    return jsonb_build_object(
      'order_id', p_order_id,
      'order_status', v_current_status,
      'payment_status', v_payment_status,
      'idempotent', true
    );
  end if;

  if v_payment_status <> 'PAID' then
    raise exception 'order payment is not confirmed';
  end if;

  if not (
    (v_current_status = 'QUEUED' and p_next_status = 'PREPARING') or
    (v_current_status = 'PREPARING' and p_next_status = 'READY') or
    (v_current_status = 'READY' and p_next_status = 'COMPLETED')
  ) then
    raise exception 'invalid kitchen transition';
  end if;

  update public.orders
     set order_status = p_next_status, updated_at = now()
   where id = p_order_id
     and tenant_id = v_tenant_id
     and order_status = v_current_status
     and payment_status = 'PAID';
  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    raise exception 'order changed during transition';
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_status', p_next_status,
    'payment_status', 'PAID',
    'idempotent', false
  );
end;
$$;

revoke all on function public.transition_kitchen_order(uuid, text) from public;
grant execute on function public.transition_kitchen_order(uuid, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
