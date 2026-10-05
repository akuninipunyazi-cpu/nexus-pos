alter table public.orders
  drop constraint if exists orders_order_type_check,
  drop constraint if exists orders_source_check,
  add constraint orders_origin_check check (
    (order_type = 'DINE_IN' and source = 'CUSTOMER' and table_id is not null)
    or
    (order_type = 'TAKEAWAY' and source = 'CASHIER' and table_id is null)
  );

create index if not exists orders_cashier_queue_idx
  on public.orders (tenant_id, order_status, payment_status, created_at desc);

create index if not exists payments_cashier_pending_idx
  on public.payments (tenant_id, status, method, created_at desc);

grant select on public.tables, public.categories, public.products to authenticated;

grant select on public.orders, public.order_items, public.payments to authenticated;

create policy "cashiers read tenant tables"
on public.tables for select to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'CASHIER');

create policy "cashiers read active tenant categories"
on public.categories for select to authenticated
using (tenant_id = public.current_tenant_id() and is_active and public.current_profile_role() = 'CASHIER');

create policy "cashiers read active tenant products"
on public.products for select to authenticated
using (tenant_id = public.current_tenant_id() and is_active and public.current_profile_role() = 'CASHIER');

create policy "cashiers read tenant orders"
on public.orders for select to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'CASHIER');

create policy "cashiers read tenant order items"
on public.order_items for select to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'CASHIER');

create policy "cashiers read tenant payments"
on public.payments for select to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'CASHIER');

create or replace function public.create_cashier_takeaway(
  p_items jsonb,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_order_id uuid;
  v_order_number text;
  v_access_token text;
  v_method text := upper(trim(p_payment_method));
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_unit_price numeric(14,2);
  v_quantity integer;
  v_note text;
  v_total numeric(14,2) := 0;
  v_item_count integer := 0;
begin
  if public.current_profile_role() <> 'CASHIER' or v_tenant_id is null then
    raise exception 'not authorized';
  end if;
  if v_method not in ('CASH', 'QRIS') then
    raise exception 'invalid payment method';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid order items';
  end if;

  insert into public.orders (
    tenant_id, order_type, source, table_id, order_status, payment_status, created_by
  ) values (
    v_tenant_id, 'TAKEAWAY', 'CASHIER', null, 'PENDING_PAYMENT', 'PENDING', auth.uid()
  ) returning id, order_number, customer_access_token
    into v_order_id, v_order_number, v_access_token;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid order item';
    end;

    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then
      raise exception 'invalid quantity';
    end if;

    select p.name, p.price
      into v_product_name, v_unit_price
      from public.products p
      join public.categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and p.is_active
       and c.is_active;

    if v_product_name is null then
      raise exception 'product unavailable';
    end if;

    v_note := nullif(left(trim(coalesce(v_item->>'note', '')), 500), '');
    insert into public.order_items (
      tenant_id, order_id, product_id, product_name_snapshot,
      unit_price_snapshot, quantity, line_total, notes
    ) values (
      v_tenant_id, v_order_id, v_product_id, v_product_name,
      v_unit_price, v_quantity, v_unit_price * v_quantity, v_note
    );
    v_total := v_total + (v_unit_price * v_quantity);
    v_item_count := v_item_count + 1;
  end loop;

  if v_item_count = 0 then
    raise exception 'order cannot be empty';
  end if;

  update public.orders set total = v_total, updated_at = now() where id = v_order_id;
  insert into public.payments (tenant_id, order_id, method, status, provider)
  values (v_tenant_id, v_order_id, v_method, 'PENDING', case when v_method = 'QRIS' then 'mock_qris' else 'manual_cash' end);

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'payment_method', v_method,
    'payment_status', 'PENDING',
    'order_status', 'PENDING_PAYMENT',
    'total', v_total
  );
end;
$$;

revoke all on function public.create_cashier_takeaway(jsonb, text) from public;
grant execute on function public.create_cashier_takeaway(jsonb, text) to authenticated;

create or replace function public.confirm_cash_payment(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_payment_status text;
  v_method text;
  v_order_status text;
  v_updated integer;
begin
  if public.current_profile_role() <> 'CASHIER' or v_tenant_id is null then
    raise exception 'not authorized';
  end if;

  select p.status, p.method, o.order_status
    into v_payment_status, v_method, v_order_status
    from public.payments p
    join public.orders o on o.id = p.order_id and o.tenant_id = p.tenant_id
   where p.order_id = p_order_id and p.tenant_id = v_tenant_id;

  if v_payment_status is null then
    raise exception 'payment not found';
  end if;
  if v_method <> 'CASH' then
    raise exception 'only cash payments can be confirmed';
  end if;
  if v_payment_status = 'PAID' and v_order_status = 'QUEUED' then
    return jsonb_build_object('order_id', p_order_id, 'payment_status', 'PAID', 'order_status', 'QUEUED', 'idempotent', true);
  end if;
  if v_payment_status <> 'PENDING' or v_order_status <> 'PENDING_PAYMENT' then
    raise exception 'invalid payment transition';
  end if;

  update public.payments
     set status = 'PAID', paid_at = now(), confirmed_by = auth.uid(), updated_at = now()
   where order_id = p_order_id and tenant_id = v_tenant_id and status = 'PENDING';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    select status into v_payment_status from public.payments where order_id = p_order_id and tenant_id = v_tenant_id;
    if v_payment_status = 'PAID' then
      return jsonb_build_object('order_id', p_order_id, 'payment_status', 'PAID', 'order_status', 'QUEUED', 'idempotent', true);
    end if;
    raise exception 'payment changed during confirmation';
  end if;

  update public.orders
     set payment_status = 'PAID', order_status = 'QUEUED', updated_at = now()
   where id = p_order_id and tenant_id = v_tenant_id and order_status = 'PENDING_PAYMENT';

  return jsonb_build_object('order_id', p_order_id, 'payment_status', 'PAID', 'order_status', 'QUEUED', 'idempotent', false);
end;
$$;

revoke all on function public.confirm_cash_payment(uuid) from public;
grant execute on function public.confirm_cash_payment(uuid) to authenticated;

create or replace function public.cancel_cashier_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_order_status text;
  v_payment_status text;
  v_updated integer;
begin
  if public.current_profile_role() <> 'CASHIER' or v_tenant_id is null then
    raise exception 'not authorized';
  end if;

  select order_status, payment_status into v_order_status, v_payment_status
    from public.orders where id = p_order_id and tenant_id = v_tenant_id;
  if v_order_status is null then raise exception 'order not found'; end if;
  if v_order_status <> 'PENDING_PAYMENT' or v_payment_status <> 'PENDING' then
    raise exception 'invalid cancellation transition';
  end if;

  update public.payments set status = 'CANCELLED', updated_at = now()
   where order_id = p_order_id and tenant_id = v_tenant_id and status = 'PENDING';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'payment changed during cancellation'; end if;
  update public.orders set payment_status = 'CANCELLED', order_status = 'CANCELLED', updated_at = now()
   where id = p_order_id and tenant_id = v_tenant_id and order_status = 'PENDING_PAYMENT';
  return jsonb_build_object('order_id', p_order_id, 'payment_status', 'CANCELLED', 'order_status', 'CANCELLED');
end;
$$;

revoke all on function public.cancel_cashier_order(uuid) from public;
grant execute on function public.cancel_cashier_order(uuid) to authenticated;