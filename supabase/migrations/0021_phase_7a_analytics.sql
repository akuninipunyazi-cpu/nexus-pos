-- Phase 7A read-only business and operational analytics.

create index if not exists orders_analytics_period_idx
  on public.orders (tenant_id, created_at, payment_status, order_status);

create index if not exists inventory_movements_analytics_period_idx
  on public.inventory_movements (tenant_id, created_at, movement_type, inventory_item_id);

create index if not exists inventory_receipts_analytics_period_idx
  on public.inventory_receipts (tenant_id, received_at, purchase_order_id);

create or replace function public.get_store_analytics(
  p_start timestamptz,
  p_end timestamptz,
  p_product_sort text default 'revenue'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role text := public.current_profile_role()::text;
  v_revenue numeric := 0;
  v_order_count bigint := 0;
  v_items_sold bigint := 0;
  v_aov numeric;
  v_order_breakdown jsonb := '[]'::jsonb;
  v_payment_breakdown jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_inventory_items jsonb := '[]'::jsonb;
  v_inventory_count bigint := 0;
  v_low_stock_count bigint := 0;
  v_out_of_stock_count bigint := 0;
  v_consumption_quantity numeric := 0;
  v_consumption_by_item jsonb := '[]'::jsonb;
  v_pending_requests bigint := 0;
  v_open_purchase_orders bigint := 0;
  v_receipt_count bigint := 0;
  v_received_quantity numeric := 0;
  v_received_value numeric := 0;
  v_receiving_lines bigint := 0;
  v_missing_price_lines bigint := 0;
  v_supplier_count bigint := 0;
  v_suppliers jsonb := '[]'::jsonb;
  v_completed_count bigint := 0;
  v_queued_count bigint := 0;
  v_preparing_count bigint := 0;
  v_ready_count bigint := 0;
  v_average_preparation_seconds numeric;
  v_orders_by_hour jsonb := '[]'::jsonb;
begin
  if v_role <> 'STORE_OWNER' or v_tenant_id is null then
    raise exception 'not authorized';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid analytics period';
  end if;

  if p_product_sort not in ('revenue', 'units') then
    raise exception 'invalid product sort';
  end if;

  -- Sales: a qualifying sale is paid and not cancelled. The order total and
  -- historical order-item snapshots remain authoritative.
  select coalesce(sum(o.total), 0), count(*)
    into v_revenue, v_order_count
    from public.orders o
   where o.tenant_id = v_tenant_id
     and o.created_at >= p_start
     and o.created_at < p_end
     and o.payment_status = 'PAID'
     and o.order_status <> 'CANCELLED';

  select coalesce(sum(oi.quantity), 0)
    into v_items_sold
    from public.order_items oi
    join public.orders o
      on o.tenant_id = oi.tenant_id
     and o.id = oi.order_id
   where o.tenant_id = v_tenant_id
     and o.created_at >= p_start
     and o.created_at < p_end
     and o.payment_status = 'PAID'
     and o.order_status <> 'CANCELLED';

  v_aov := case when v_order_count = 0 then null else v_revenue / v_order_count end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_type', x.order_type,
    'orders', x.orders,
    'revenue', x.revenue
  ) order by x.order_type), '[]'::jsonb)
    into v_order_breakdown
    from (
      select o.order_type, count(*) as orders, coalesce(sum(o.total), 0) as revenue
        from public.orders o
       where o.tenant_id = v_tenant_id
         and o.created_at >= p_start
         and o.created_at < p_end
         and o.payment_status = 'PAID'
         and o.order_status <> 'CANCELLED'
       group by o.order_type
    ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'method', x.method,
    'orders', x.orders,
    'revenue', x.revenue
  ) order by x.method), '[]'::jsonb)
    into v_payment_breakdown
    from (
      select p.method, count(*) as orders, coalesce(sum(o.total), 0) as revenue
        from public.payments p
        join public.orders o
          on o.tenant_id = p.tenant_id
         and o.id = p.order_id
       where p.tenant_id = v_tenant_id
         and p.created_at >= p_start
         and p.created_at < p_end
         and p.status = 'PAID'
         and o.payment_status = 'PAID'
         and o.order_status <> 'CANCELLED'
       group by p.method
    ) x;

  -- Product performance uses historical order-item snapshots.
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', p.id,
    'product_name', p.name,
    'category_name', c.name,
    'units_sold', coalesce(s.units_sold, 0),
    'revenue', coalesce(s.revenue, 0)
  ) order by
    case when p_product_sort = 'units' then coalesce(s.units_sold, 0) end desc nulls last,
    case when p_product_sort = 'revenue' then coalesce(s.revenue, 0) end desc nulls last,
    p.name
  ), '[]'::jsonb)
    into v_products
    from public.products p
    join public.categories c
      on c.tenant_id = p.tenant_id
     and c.id = p.category_id
    left join (
      select oi.product_id, sum(oi.quantity) as units_sold, sum(oi.line_total) as revenue
        from public.order_items oi
        join public.orders o
          on o.tenant_id = oi.tenant_id
         and o.id = oi.order_id
       where oi.tenant_id = v_tenant_id
         and o.created_at >= p_start
         and o.created_at < p_end
         and o.payment_status = 'PAID'
         and o.order_status <> 'CANCELLED'
       group by oi.product_id
    ) s
      on s.product_id = p.id
   where p.tenant_id = v_tenant_id
     and (p.is_active or s.product_id is not null);

  -- Current stock is the signed movement ledger. WASTE is outbound and is
  -- intentionally excluded from normal CONSUME analytics below.
  with balances as (
    select i.id, i.name, i.unit, i.minimum_stock, i.is_active,
           coalesce(sum(case
             when m.movement_type in ('RECEIVE','ADJUSTMENT_IN','RETURN','TRANSFER_IN')
               then m.quantity
             else -m.quantity
           end), 0) as current_stock
      from public.inventory_items i
      left join public.inventory_movements m
        on m.tenant_id = i.tenant_id
       and m.inventory_item_id = i.id
     where i.tenant_id = v_tenant_id
       and i.is_active
     group by i.id, i.name, i.unit, i.minimum_stock, i.is_active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'name', name,
    'unit', unit,
    'minimum_stock', minimum_stock,
    'current_stock', current_stock,
    'stock_status', case when current_stock <= 0 then 'OUT_OF_STOCK' when current_stock <= minimum_stock then 'LOW_STOCK' else 'OK' end
  ) order by name), '[]'::jsonb)
    into v_inventory_items
    from balances;

  select count(*), count(*) filter (where current_stock <= minimum_stock), count(*) filter (where current_stock <= 0)
    into v_inventory_count, v_low_stock_count, v_out_of_stock_count
    from (
      select i.id, coalesce(sum(case
        when m.movement_type in ('RECEIVE','ADJUSTMENT_IN','RETURN','TRANSFER_IN') then m.quantity
        else -m.quantity
      end), 0) as current_stock, i.minimum_stock
        from public.inventory_items i
        left join public.inventory_movements m
          on m.tenant_id = i.tenant_id
         and m.inventory_item_id = i.id
       where i.tenant_id = v_tenant_id
         and i.is_active
       group by i.id, i.minimum_stock
    ) balances;

  select coalesce(sum(m.quantity), 0)
    into v_consumption_quantity
    from public.inventory_movements m
   where m.tenant_id = v_tenant_id
     and m.movement_type = 'CONSUME'
     and m.created_at >= p_start
     and m.created_at < p_end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'inventory_item_id', x.inventory_item_id,
    'item_name', x.item_name,
    'unit', x.unit,
    'quantity', x.quantity
  ) order by x.item_name), '[]'::jsonb)
    into v_consumption_by_item
    from (
      select m.inventory_item_id, i.name as item_name, i.unit, sum(m.quantity) as quantity
        from public.inventory_movements m
        join public.inventory_items i
          on i.tenant_id = m.tenant_id
         and i.id = m.inventory_item_id
       where m.tenant_id = v_tenant_id
         and m.movement_type = 'CONSUME'
         and m.created_at >= p_start
         and m.created_at < p_end
       group by m.inventory_item_id, i.name, i.unit
    ) x;

  select count(*) into v_pending_requests
    from public.purchase_requests
   where tenant_id = v_tenant_id
     and status = 'SUBMITTED';

  select count(*) into v_open_purchase_orders
    from public.purchase_orders
   where tenant_id = v_tenant_id
     and status in ('DRAFT','PENDING_APPROVAL','APPROVED','ORDERED','PARTIALLY_RECEIVED');

  select count(distinct r.id), coalesce(sum(ri.quantity_received), 0),
         coalesce(sum(case when poi.unit_price is not null then ri.quantity_received * poi.unit_price else 0 end), 0),
         count(ri.id), count(*) filter (where poi.unit_price is null)
    into v_receipt_count, v_received_quantity, v_received_value, v_receiving_lines, v_missing_price_lines
    from public.inventory_receipts r
    join public.inventory_receipt_items ri
      on ri.tenant_id = r.tenant_id
     and ri.receipt_id = r.id
    join public.purchase_order_items poi
      on poi.tenant_id = ri.tenant_id
     and poi.id = ri.purchase_order_item_id
   where r.tenant_id = v_tenant_id
     and r.received_at >= p_start
     and r.received_at < p_end;

  select count(*) into v_supplier_count
    from public.suppliers
   where tenant_id = v_tenant_id
     and is_active;

  select coalesce(jsonb_agg(jsonb_build_object(
    'supplier_id', s.id,
    'supplier_name', s.name,
    'purchase_orders', coalesce(pc.purchase_orders, 0),
    'received_orders', coalesce(rc.received_orders, 0)
  ) order by s.name), '[]'::jsonb)
    into v_suppliers
    from public.suppliers s
    left join (
      select supplier_id, count(*) as purchase_orders
        from public.purchase_orders
       where tenant_id = v_tenant_id
       group by supplier_id
    ) pc on pc.supplier_id = s.id
    left join (
      select po.supplier_id, count(distinct r.purchase_order_id) as received_orders
        from public.purchase_orders po
        join public.inventory_receipts r
          on r.tenant_id = po.tenant_id
         and r.purchase_order_id = po.id
       where po.tenant_id = v_tenant_id
       group by po.supplier_id
    ) rc on rc.supplier_id = s.id
   where s.tenant_id = v_tenant_id
     and s.is_active;

  select count(*)
    into v_completed_count
    from public.orders
   where tenant_id = v_tenant_id
     and order_status = 'COMPLETED'
     and completed_at >= p_start
     and completed_at < p_end;

  select count(*) filter (where order_status = 'QUEUED'),
         count(*) filter (where order_status = 'PREPARING'),
         count(*) filter (where order_status = 'READY')
    into v_queued_count, v_preparing_count, v_ready_count
    from public.orders
   where tenant_id = v_tenant_id;

  select avg(extract(epoch from (preparing_at - queued_at)))
    into v_average_preparation_seconds
    from public.orders
   where tenant_id = v_tenant_id
     and preparing_at is not null
     and queued_at is not null
     and preparing_at >= p_start
     and preparing_at < p_end
     and preparing_at >= queued_at;

  select coalesce(jsonb_agg(jsonb_build_object(
    'hour', x.hour,
    'orders', x.orders
  ) order by x.hour), '[]'::jsonb)
    into v_orders_by_hour
    from (
      select extract(hour from timezone('Asia/Jakarta', o.created_at))::integer as hour, count(*) as orders
        from public.orders o
       where o.tenant_id = v_tenant_id
         and o.created_at >= p_start
         and o.created_at < p_end
         and o.payment_status = 'PAID'
         and o.order_status <> 'CANCELLED'
       group by extract(hour from timezone('Asia/Jakarta', o.created_at))::integer
    ) x;

  return jsonb_build_object(
    'sales', jsonb_build_object(
      'revenue', v_revenue,
      'orders', v_order_count,
      'aov', v_aov,
      'items_sold', v_items_sold,
      'by_order_type', v_order_breakdown,
      'by_payment_method', v_payment_breakdown
    ),
    'products', v_products,
    'inventory', jsonb_build_object(
      'item_count', v_inventory_count,
      'low_stock_count', v_low_stock_count,
      'out_of_stock_count', v_out_of_stock_count,
      'consumption_quantity', v_consumption_quantity,
      'items', v_inventory_items,
      'consumption_by_item', v_consumption_by_item
    ),
    'purchasing', jsonb_build_object(
      'pending_request_count', v_pending_requests,
      'open_purchase_order_count', v_open_purchase_orders,
      'receipt_count', v_receipt_count,
      'received_quantity', v_received_quantity,
      'received_value', case when v_receiving_lines = 0 or v_missing_price_lines = 0 then v_received_value else null end,
      'received_value_available', (v_receiving_lines = 0 or v_missing_price_lines = 0),
      'supplier_count', v_supplier_count,
      'suppliers', v_suppliers
    ),
    'operations', jsonb_build_object(
      'completed_orders', v_completed_count,
      'queued_count', v_queued_count,
      'preparing_count', v_preparing_count,
      'ready_count', v_ready_count,
      'average_preparation_seconds', v_average_preparation_seconds,
      'orders_by_hour', v_orders_by_hour
    )
  );
end;
$$;

revoke all on function public.get_store_analytics(timestamptz, timestamptz, text) from public;
grant execute on function public.get_store_analytics(timestamptz, timestamptz, text) to authenticated;
