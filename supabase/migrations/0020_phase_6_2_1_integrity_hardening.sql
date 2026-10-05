-- Phase 6.2.1 integrity hardening.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type in ('RECEIVE','CONSUME','ADJUSTMENT_IN','ADJUSTMENT_OUT','RETURN','TRANSFER_IN','TRANSFER_OUT','WASTE'));

create or replace function public.record_inventory_adjustment(p_inventory_item_id uuid,p_movement_type text,p_quantity numeric,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_tenant_id uuid:=public.current_tenant_id();
 v_role text:=public.current_profile_role()::text;
 v_item record;
 v_existing record;
 v_movement_id uuid;
 v_current_stock numeric:=0;
 v_key text:=trim(coalesce(p_idempotency_key,''));
 v_type text:=upper(trim(coalesce(p_movement_type,'')));
 v_reason text:=nullif(left(trim(coalesce(p_reason,'')),500),'');
begin
 if v_role not in('STORE_OWNER','KITCHEN_ADMIN') or v_tenant_id is null then raise exception 'not authorized';end if;
 if v_type not in('ADJUSTMENT_IN','ADJUSTMENT_OUT','WASTE') then raise exception 'invalid adjustment type';end if;
 if p_quantity is null or p_quantity<=0 then raise exception 'invalid adjustment quantity';end if;
 if char_length(v_key)<8 or char_length(v_key)>200 then raise exception 'invalid idempotency key';end if;
 select id,unit,is_active into v_item from public.inventory_items where id=p_inventory_item_id and tenant_id=v_tenant_id for update;
 if not found or not v_item.is_active then raise exception 'inventory item unavailable';end if;
 select id,inventory_item_id,movement_type,quantity,reason into v_existing from public.inventory_movements where tenant_id=v_tenant_id and idempotency_key=v_key for update;
 if found then
  if v_existing.inventory_item_id<>p_inventory_item_id or v_existing.movement_type<>v_type or v_existing.quantity<>p_quantity or v_existing.reason is distinct from v_reason then raise exception 'idempotency key payload conflict';end if;
  return jsonb_build_object('movement_id',v_existing.id,'idempotent',true);
 end if;
 select coalesce(sum(case when movement_type in('RECEIVE','ADJUSTMENT_IN','RETURN','TRANSFER_IN') then quantity else -quantity end),0) into v_current_stock from public.inventory_movements where tenant_id=v_tenant_id and inventory_item_id=p_inventory_item_id;
 if v_type in('ADJUSTMENT_OUT','WASTE') and v_current_stock<p_quantity then raise exception 'insufficient stock';end if;
 insert into public.inventory_movements(tenant_id,inventory_item_id,movement_type,quantity,unit,reason,idempotency_key,created_by)
 values(v_tenant_id,p_inventory_item_id,v_type,p_quantity,v_item.unit,v_reason,v_key,auth.uid()) returning id into v_movement_id;
 return jsonb_build_object('movement_id',v_movement_id,'idempotent',false);
exception when unique_violation then
 select id,inventory_item_id,movement_type,quantity,reason into v_existing from public.inventory_movements where tenant_id=v_tenant_id and idempotency_key=v_key;
 if not found then raise;end if;
 if v_existing.inventory_item_id<>p_inventory_item_id or v_existing.movement_type<>v_type or v_existing.quantity<>p_quantity or v_existing.reason is distinct from v_reason then raise exception 'idempotency key payload conflict';end if;
 return jsonb_build_object('movement_id',v_existing.id,'idempotent',true);
end;
$$;

revoke all on function public.record_inventory_adjustment(uuid,text,numeric,text,text) from public;
grant execute on function public.record_inventory_adjustment(uuid,text,numeric,text,text) to authenticated;

create or replace function public.receive_purchase_order(p_purchase_order_id uuid,p_items jsonb,p_idempotency_key text,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_tenant_id uuid:=public.current_tenant_id();
 v_key text:=trim(coalesce(p_idempotency_key,''));
 v_fingerprint text:=md5(coalesce(p_items,'[]'::jsonb)::text);
 v_existing_fingerprint text;
 v_receipt_id uuid;
 v_receipt_number text;
 v_status text;
 v_item jsonb;
 v_po_item record;
 v_qty numeric;
 v_count integer:=0;
 v_item_id uuid;
begin
 if public.current_profile_role()<>'STORE_OWNER' or v_tenant_id is null then raise exception 'not authorized';end if;
 if char_length(v_key)<8 or char_length(v_key)>200 then raise exception 'invalid idempotency key';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'invalid receipt items';end if;

 select id,idempotency_fingerprint into v_receipt_id,v_existing_fingerprint from public.inventory_receipts where tenant_id=v_tenant_id and idempotency_key=v_key for update;
 if found then
  if v_existing_fingerprint<>v_fingerprint then raise exception 'idempotency key payload conflict';end if;
  return jsonb_build_object('receipt_id',v_receipt_id,'idempotent',true);
 end if;

 if exists(
   select 1 from(
     select trim(coalesce(value->>'purchase_order_item_id','')) as item_key
     from jsonb_array_elements(p_items)
   ) submitted
   group by item_key
   having count(*)>1
 ) then raise exception 'duplicate receipt item';end if;

 select status into v_status from public.purchase_orders where id=p_purchase_order_id and tenant_id=v_tenant_id for update;
 if not found or v_status not in('APPROVED','ORDERED','PARTIALLY_RECEIVED') then raise exception 'purchase order is not receivable';end if;

 insert into public.inventory_receipts(tenant_id,purchase_order_id,idempotency_key,idempotency_fingerprint,received_by,notes)
 values(v_tenant_id,p_purchase_order_id,v_key,v_fingerprint,auth.uid(),nullif(left(trim(coalesce(p_notes,'')),1000),''))
 returning id,receipt_number into v_receipt_id,v_receipt_number;

 for v_item in select value from jsonb_array_elements(p_items) loop
  begin
   v_item_id:=(v_item->>'purchase_order_item_id')::uuid;
   v_qty:=(v_item->>'quantity')::numeric;
  exception when invalid_text_representation then raise exception 'invalid receipt item';end;
  if v_qty is null or v_qty<=0 then raise exception 'invalid received quantity';end if;
  select poi.id,poi.inventory_item_id,poi.unit,poi.quantity_ordered,poi.quantity_received into v_po_item
  from public.purchase_order_items poi
  where poi.id=v_item_id and poi.tenant_id=v_tenant_id and poi.purchase_order_id=p_purchase_order_id
  for update;
  if not found then raise exception 'purchase order item not found';end if;
  if v_qty>v_po_item.quantity_ordered-v_po_item.quantity_received then raise exception 'received quantity exceeds outstanding quantity';end if;
  insert into public.inventory_receipt_items(tenant_id,receipt_id,purchase_order_item_id,quantity_received,unit)
  values(v_tenant_id,v_receipt_id,v_po_item.id,v_qty,v_po_item.unit);
  insert into public.inventory_movements(tenant_id,inventory_item_id,movement_type,quantity,unit,purchase_order_id,receipt_id,created_by)
  values(v_tenant_id,v_po_item.inventory_item_id,'RECEIVE',v_qty,v_po_item.unit,p_purchase_order_id,v_receipt_id,auth.uid());
  update public.purchase_order_items set quantity_received=quantity_received+v_qty where id=v_po_item.id and tenant_id=v_tenant_id;
  v_count:=v_count+1;
 end loop;

 if v_count=0 then raise exception 'receipt cannot be empty';end if;
 if exists(select 1 from public.purchase_order_items where purchase_order_id=p_purchase_order_id and tenant_id=v_tenant_id and quantity_received<quantity_ordered) then
  update public.purchase_orders set status='PARTIALLY_RECEIVED',updated_at=now() where id=p_purchase_order_id and tenant_id=v_tenant_id;
 else
  update public.purchase_orders set status='RECEIVED',updated_at=now() where id=p_purchase_order_id and tenant_id=v_tenant_id;
 end if;
 return jsonb_build_object('receipt_id',v_receipt_id,'receipt_number',v_receipt_number,'idempotent',false);
exception when unique_violation then
 select id,idempotency_fingerprint into v_receipt_id,v_existing_fingerprint from public.inventory_receipts where tenant_id=v_tenant_id and idempotency_key=v_key;
 if not found then raise;end if;
 if v_existing_fingerprint<>v_fingerprint then raise exception 'idempotency key payload conflict';end if;
 return jsonb_build_object('receipt_id',v_receipt_id,'idempotent',true);
end;
$$;

revoke all on function public.receive_purchase_order(uuid,jsonb,text,text) from public;
grant execute on function public.receive_purchase_order(uuid,jsonb,text,text) to authenticated;
