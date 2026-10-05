create or replace function public.create_cashier_takeaway(
  p_items jsonb,
  p_payment_method text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_order_number text;
  v_access_token text;
  v_method text := upper(trim(p_payment_method));
  v_key text := trim(coalesce(p_idempotency_key, ''));
  v_fingerprint text;
  v_existing_fingerprint text;
  v_existing_creator uuid;
  v_payment_status text;
  v_order_status text;
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
  if char_length(v_key) < 8 or char_length(v_key) > 200 then
    raise exception 'invalid idempotency key';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid order items';
  end if;

  v_fingerprint := md5(p_items::text || '|' || v_method);

  select id, order_number, customer_access_token, total, payment_status, order_status,
         idempotency_fingerprint, created_by
    into v_order_id, v_order_number, v_access_token, v_total, v_payment_status,
         v_order_status, v_existing_fingerprint, v_existing_creator
    from public.orders
   where tenant_id = v_tenant_id
     and order_type = 'TAKEAWAY'
     and idempotency_key = v_key;

  if found then
    if v_existing_creator <> v_user_id then
      raise exception 'idempotency key is already in use';
    end if;
    if v_existing_fingerprint <> v_fingerprint then
      raise exception 'idempotency key payload conflict';
    end if;
    return jsonb_build_object(
      'order_id', v_order_id,
      'order_number', v_order_number,
      'payment_method', v_method,
      'payment_status', v_payment_status,
      'order_status', v_order_status,
      'total', v_total,
      'idempotent', true
    );
  end if;

  v_total := 0;

  begin
    insert into public.orders (
      tenant_id, order_type, source, table_id, order_status, payment_status,
      created_by, idempotency_key, idempotency_fingerprint
    ) values (
      v_tenant_id, 'TAKEAWAY', 'CASHIER', null, 'PENDING_PAYMENT', 'PENDING',
      v_user_id, v_key, v_fingerprint
    ) returning id, order_number, customer_access_token
      into v_order_id, v_order_number, v_access_token;
  exception when unique_violation then
    select id, order_number, customer_access_token, total, payment_status, order_status,
           idempotency_fingerprint, created_by
      into v_order_id, v_order_number, v_access_token, v_total, v_payment_status,
           v_order_status, v_existing_fingerprint, v_existing_creator
      from public.orders
     where tenant_id = v_tenant_id
       and order_type = 'TAKEAWAY'
       and idempotency_key = v_key;
    if not found then raise exception 'takeaway order could not be created'; end if;
    if v_existing_creator <> v_user_id then raise exception 'idempotency key is already in use'; end if;
    if v_existing_fingerprint <> v_fingerprint then raise exception 'idempotency key payload conflict'; end if;
    return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'payment_method', v_method, 'payment_status', v_payment_status, 'order_status', v_order_status, 'total', v_total, 'idempotent', true);
  end;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid order item';
    end;
    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then raise exception 'invalid quantity'; end if;

    select p.name, p.price into v_product_name, v_unit_price
      from public.products p
      join public.categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
     where p.id = v_product_id and p.tenant_id = v_tenant_id and p.is_active and c.is_active;
    if v_product_name is null then raise exception 'product unavailable'; end if;

    v_note := nullif(left(trim(coalesce(v_item->>'note', '')), 500), '');
    insert into public.order_items (tenant_id, order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, line_total, notes)
    values (v_tenant_id, v_order_id, v_product_id, v_product_name, v_unit_price, v_quantity, v_unit_price * v_quantity, v_note);
    v_total := v_total + (v_unit_price * v_quantity);
    v_item_count := v_item_count + 1;
  end loop;

  if v_item_count = 0 then raise exception 'order cannot be empty'; end if;
  update public.orders set total = v_total, updated_at = now() where id = v_order_id;
  insert into public.payments (tenant_id, order_id, method, status, provider)
  values (v_tenant_id, v_order_id, v_method, 'PENDING', case when v_method = 'QRIS' then 'mock_qris' else 'manual_cash' end);

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'payment_method', v_method, 'payment_status', 'PENDING', 'order_status', 'PENDING_PAYMENT', 'total', v_total, 'idempotent', false);
end;
$$;


revoke all on function public.create_cashier_takeaway(jsonb, text, text) from public;
grant execute on function public.create_cashier_takeaway(jsonb, text, text) to authenticated;
