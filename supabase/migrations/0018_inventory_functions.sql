-- Phase 6.2 transactional inventory, recipe, purchasing, and kitchen integration.
alter table public.purchase_requests add column if not exists idempotency_fingerprint text;
create or replace function public.record_inventory_adjustment(p_inventory_item_id uuid,p_movement_type text,p_quantity numeric,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant_id uuid:=public.current_tenant_id();v_role text:=public.current_profile_role()::text;v_item record;v_movement_id uuid;v_current_stock numeric:=0;v_key text:=trim(coalesce(p_idempotency_key,''));v_type text:=upper(trim(coalesce(p_movement_type,'')));
begin
if v_role not in('STORE_OWNER','KITCHEN_ADMIN') or v_tenant_id is null then raise exception 'not authorized';end if;
if v_type not in('ADJUSTMENT_IN','ADJUSTMENT_OUT') then raise exception 'invalid adjustment type';end if;
if p_quantity is null or p_quantity<=0 then raise exception 'invalid adjustment quantity';end if;
if char_length(v_key)<8 or char_length(v_key)>200 then raise exception 'invalid idempotency key';end if;
select id,unit,is_active into v_item from public.inventory_items where id=p_inventory_item_id and tenant_id=v_tenant_id for update;
if not found or not v_item.is_active then raise exception 'inventory item unavailable';end if;
select id into v_movement_id from public.inventory_movements where tenant_id=v_tenant_id and idempotency_key=v_key;
if found then return jsonb_build_object('movement_id',v_movement_id,'idempotent',true);end if;
select coalesce(sum(case when movement_type in('RECEIVE','ADJUSTMENT_IN','RETURN','TRANSFER_IN') then quantity else -quantity end),0) into v_current_stock from public.inventory_movements where tenant_id=v_tenant_id and inventory_item_id=p_inventory_item_id;
if v_type='ADJUSTMENT_OUT' and v_current_stock<p_quantity then raise exception 'insufficient stock';end if;
insert into public.inventory_movements(tenant_id,inventory_item_id,movement_type,quantity,unit,reason,idempotency_key,created_by) values(v_tenant_id,p_inventory_item_id,v_type,p_quantity,v_item.unit,nullif(left(trim(coalesce(p_reason,'')),500),''),v_key,auth.uid()) returning id into v_movement_id;
return jsonb_build_object('movement_id',v_movement_id,'idempotent',false);
exception when unique_violation then
select id into v_movement_id from public.inventory_movements where tenant_id=v_tenant_id and idempotency_key=v_key;
if v_movement_id is null then raise;end if;
return jsonb_build_object('movement_id',v_movement_id,'idempotent',true);
end;$$;
revoke all on function public.record_inventory_adjustment(uuid,text,numeric,text,text) from public;
grant execute on function public.record_inventory_adjustment(uuid,text,numeric,text,text) to authenticated;
create or replace function public.save_recipe(p_product_id uuid,p_items jsonb,p_is_active boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant_id uuid:=public.current_tenant_id();v_recipe_id uuid;v_item jsonb;v_inventory_item record;v_quantity numeric;v_unit text;v_count integer:=0;
begin
if public.current_profile_role()<>'STORE_OWNER' or v_tenant_id is null then raise exception 'not authorized';end if;
if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'invalid recipe items';end if;
if not exists(select 1 from public.products where id=p_product_id and tenant_id=v_tenant_id) then raise exception 'product not found';end if;
insert into public.recipes(tenant_id,product_id,is_active,created_by) values(v_tenant_id,p_product_id,coalesce(p_is_active,true),auth.uid()) on conflict(tenant_id,product_id) do update set is_active=excluded.is_active,updated_at=now() returning id into v_recipe_id;
delete from public.recipe_items where tenant_id=v_tenant_id and recipe_id=v_recipe_id;
for v_item in select value from jsonb_array_elements(p_items) loop
begin v_quantity:=(v_item->>'quantity')::numeric;exception when invalid_text_representation then raise exception 'invalid recipe item';end;
v_unit:=nullif(trim(v_item->>'unit'),'');
if v_quantity is null or v_quantity<=0 then raise exception 'invalid recipe quantity';end if;
begin select id,unit,is_active into v_inventory_item from public.inventory_items where id=(v_item->>'inventory_item_id')::uuid and tenant_id=v_tenant_id;exception when invalid_text_representation then raise exception 'invalid recipe item';end;
if not found or not v_inventory_item.is_active then raise exception 'inventory item unavailable';end if;
if v_unit is null or v_unit<>v_inventory_item.unit then raise exception 'recipe unit does not match inventory unit';end if;
insert into public.recipe_items(tenant_id,recipe_id,inventory_item_id,quantity,unit) values(v_tenant_id,v_recipe_id,v_inventory_item.id,v_quantity,v_unit);v_count:=v_count+1;
end loop;
return jsonb_build_object('recipe_id',v_recipe_id,'item_count',v_count);
end;$$;
revoke all on function public.save_recipe(uuid,jsonb,boolean) from public;
grant execute on function public.save_recipe(uuid,jsonb,boolean) to authenticated;
create or replace function public.create_purchase_request(p_items jsonb,p_supplier_id uuid default null,p_reason text default null,p_notes text default null,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant_id uuid:=public.current_tenant_id();v_role text:=public.current_profile_role()::text;v_user_id uuid:=auth.uid();v_key text:=trim(coalesce(p_idempotency_key,''));v_fingerprint text:=md5(coalesce(p_items,'[]'::jsonb)::text||'|'||coalesce(p_supplier_id::text,'')||'|'||coalesce(p_reason,'')||'|'||coalesce(p_notes,''));v_request_id uuid;v_request_number text;v_existing_fingerprint text;v_item jsonb;v_inventory_item record;v_quantity numeric;v_count integer:=0;
begin
if v_role not in('STORE_OWNER','KITCHEN_ADMIN') or v_tenant_id is null then raise exception 'not authorized';end if;
if char_length(v_key)<8 or char_length(v_key)>200 then raise exception 'invalid idempotency key';end if;
if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'invalid request items';end if;
if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and tenant_id=v_tenant_id and is_active) then raise exception 'supplier unavailable';end if;
select id,request_number,idempotency_fingerprint into v_request_id,v_request_number,v_existing_fingerprint from public.purchase_requests where tenant_id=v_tenant_id and idempotency_key=v_key for update;
if found then if v_existing_fingerprint<>v_fingerprint then raise exception 'idempotency key payload conflict';end if;return jsonb_build_object('request_id',v_request_id,'request_number',v_request_number,'idempotent',true);end if;
insert into public.purchase_requests(tenant_id,status,supplier_id,reason,notes,idempotency_key,idempotency_fingerprint,created_by) values(v_tenant_id,'SUBMITTED',p_supplier_id,nullif(left(trim(coalesce(p_reason,'')),500),''),nullif(left(trim(coalesce(p_notes,'')),1000),''),v_key,v_fingerprint,v_user_id) returning id,request_number into v_request_id,v_request_number;
for v_item in select value from jsonb_array_elements(p_items) loop
begin v_quantity:=(v_item->>'quantity')::numeric;exception when invalid_text_representation then raise exception 'invalid request quantity';end;
if v_quantity is null or v_quantity<=0 then raise exception 'invalid request quantity';end if;
begin select id,unit,is_active into v_inventory_item from public.inventory_items where id=(v_item->>'inventory_item_id')::uuid and tenant_id=v_tenant_id;exception when invalid_text_representation then raise exception 'invalid request item';end;
if not found or not v_inventory_item.is_active then raise exception 'inventory item unavailable';end if;
insert into public.purchase_request_items(tenant_id,request_id,inventory_item_id,quantity,unit) values(v_tenant_id,v_request_id,v_inventory_item.id,v_quantity,v_inventory_item.unit);v_count:=v_count+1;
end loop;
if v_count=0 then raise exception 'request cannot be empty';end if;
return jsonb_build_object('request_id',v_request_id,'request_number',v_request_number,'idempotent',false);
exception when unique_violation then
select id,request_number,idempotency_fingerprint into v_request_id,v_request_number,v_existing_fingerprint from public.purchase_requests where tenant_id=v_tenant_id and idempotency_key=v_key;
if v_existing_fingerprint<>v_fingerprint then raise exception 'idempotency key payload conflict';end if;
return jsonb_build_object('request_id',v_request_id,'request_number',v_request_number,'idempotent',true);
end;$$;
revoke all on function public.create_purchase_request(jsonb,uuid,text,text,text) from public;
grant execute on function public.create_purchase_request(jsonb,uuid,text,text,text) to authenticated;
create or replace function public.set_purchase_request_status(p_request_id uuid,p_next_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant_id uuid:=public.current_tenant_id();v_status text;v_next text:=upper(trim(p_next_status));
begin
if public.current_profile_role()<>'STORE_OWNER' or v_tenant_id is null then raise exception 'not authorized';end if;
if v_next not in('APPROVED','REJECTED','CANCELLED') then raise exception 'invalid request status';end if;
select status into v_status from public.purchase_requests where id=p_request_id and tenant_id=v_tenant_id for update;
if not found then raise exception 'request not found';end if;
if not((v_status='SUBMITTED' and v_next in('APPROVED','REJECTED','CANCELLED')) or(v_status='DRAFT' and v_next in('SUBMITTED','CANCELLED'))) then raise exception 'invalid request transition';end if;
update public.purchase_requests set status=v_next,approved_by=case when v_next='APPROVED' then auth.uid() else approved_by end,updated_at=now() where id=p_request_id and tenant_id=v_tenant_id;
return jsonb_build_object('request_id',p_request_id,'status',v_next);
end;$$;
revoke all on function public.set_purchase_request_status(uuid,text) from public;
grant execute on function public.set_purchase_request_status(uuid,text) to authenticated;
create or replace function public.create_purchase_order(p_supplier_id uuid,p_items jsonb,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant_id uuid:=public.current_tenant_id();v_po_id uuid;v_po_number text;v_item jsonb;v_inventory_item record;v_quantity numeric;v_price numeric;v_count integer:=0;v_request_status text;
begin
if public.current_profile_role()<>'STORE_OWNER' or v_tenant_id is null then raise exception 'not authorized';end if;
if not exists(select 1 from public.suppliers where id=p_supplier_id and tenant_id=v_tenant_id and is_active) then raise exception 'supplier unavailable';end if;
if p_request_id is not null then select status into v_request_status from public.purchase_requests where id=p_request_id and tenant_id=v_tenant_id;if v_request_status is null or v_request_status<>'APPROVED' then raise exception 'purchase request is not approved';end if;end if;
if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'invalid purchase order items';end if;
insert into public.purchase_orders(tenant_id,supplier_id,request_id,status,created_by) values(v_tenant_id,p_supplier_id,p_request_id,'PENDING_APPROVAL',auth.uid()) returning id,po_number into v_po_id,v_po_number;
for v_item in select value from jsonb_array_elements(p_items) loop
begin v_quantity:=(v_item->>'quantity')::numeric;v_price:=nullif(v_item->>'unit_price','')::numeric;exception when invalid_text_representation then raise exception 'invalid purchase order item';end;
if v_quantity is null or v_quantity<=0 or(v_price is not null and v_price<0) then raise exception 'invalid purchase order quantity or price';end if;
begin select id,unit,is_active into v_inventory_item from public.inventory_items where id=(v_item->>'inventory_item_id')::uuid and tenant_id=v_tenant_id;exception when invalid_text_representation then raise exception 'invalid purchase order item';end;
if not found or not v_inventory_item.is_active then raise exception 'inventory item unavailable';end if;
insert into public.purchase_order_items(tenant_id,purchase_order_id,inventory_item_id,quantity_ordered,unit,unit_price) values(v_tenant_id,v_po_id,v_inventory_item.id,v_quantity,v_inventory_item.unit,v_price);v_count:=v_count+1;
end loop;
if v_count=0 then raise exception 'purchase order cannot be empty';end if;
return jsonb_build_object('purchase_order_id',v_po_id,'po_number',v_po_number);
end;$$;
revoke all on function public.create_purchase_order(uuid,jsonb,uuid) from public;
grant execute on function public.create_purchase_order(uuid,jsonb,uuid) to authenticated;
create or replace function public.set_purchase_order_status(p_purchase_order_id uuid,p_next_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant_id uuid:=public.current_tenant_id();v_status text;v_next text:=upper(trim(p_next_status));
begin
if public.current_profile_role()<>'STORE_OWNER' or v_tenant_id is null then raise exception 'not authorized';end if;
if v_next not in('APPROVED','ORDERED','CANCELLED') then raise exception 'invalid purchase order status';end if;
select status into v_status from public.purchase_orders where id=p_purchase_order_id and tenant_id=v_tenant_id for update;
if not found then raise exception 'purchase order not found';end if;
if not((v_status='PENDING_APPROVAL' and v_next in('APPROVED','CANCELLED')) or(v_status='APPROVED' and v_next in('ORDERED','CANCELLED')) or(v_status='ORDERED' and v_next='CANCELLED')) then raise exception 'invalid purchase order transition';end if;
update public.purchase_orders set status=v_next,approved_by=case when v_next='APPROVED' then auth.uid() else approved_by end,approved_at=case when v_next='APPROVED' then now() else approved_at end,updated_at=now() where id=p_purchase_order_id and tenant_id=v_tenant_id;
return jsonb_build_object('purchase_order_id',p_purchase_order_id,'status',v_next);
end;$$;
revoke all on function public.set_purchase_order_status(uuid,text) from public;
grant execute on function public.set_purchase_order_status(uuid,text) to authenticated;
create or replace function public.receive_purchase_order(p_purchase_order_id uuid,p_items jsonb,p_idempotency_key text,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant_id uuid:=public.current_tenant_id();v_key text:=trim(coalesce(p_idempotency_key,''));v_fingerprint text:=md5(coalesce(p_items,'[]'::jsonb)::text);v_existing_fingerprint text;v_receipt_id uuid;v_receipt_number text;v_status text;v_item jsonb;v_po_item record;v_qty numeric;v_count integer:=0;v_item_id uuid;
begin
if public.current_profile_role()<>'STORE_OWNER' or v_tenant_id is null then raise exception 'not authorized';end if;
if char_length(v_key)<8 or char_length(v_key)>200 then raise exception 'invalid idempotency key';end if;
if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'invalid receipt items';end if;
select id,idempotency_fingerprint into v_receipt_id,v_existing_fingerprint from public.inventory_receipts where tenant_id=v_tenant_id and idempotency_key=v_key for update;
if found then if v_existing_fingerprint<>v_fingerprint then raise exception 'idempotency key payload conflict';end if;return jsonb_build_object('receipt_id',v_receipt_id,'idempotent',true);end if;
select status into v_status from public.purchase_orders where id=p_purchase_order_id and tenant_id=v_tenant_id for update;
if not found or v_status not in('APPROVED','ORDERED','PARTIALLY_RECEIVED') then raise exception 'purchase order is not receivable';end if;
insert into public.inventory_receipts(tenant_id,purchase_order_id,idempotency_key,idempotency_fingerprint,received_by,notes) values(v_tenant_id,p_purchase_order_id,v_key,v_fingerprint,auth.uid(),nullif(left(trim(coalesce(p_notes,'')),1000),'')) returning id,receipt_number into v_receipt_id,v_receipt_number;
for v_item in select value from jsonb_array_elements(p_items) loop
begin v_item_id:=(v_item->>'purchase_order_item_id')::uuid;v_qty:=(v_item->>'quantity')::numeric;exception when invalid_text_representation then raise exception 'invalid receipt item';end;
if v_qty is null or v_qty<=0 then raise exception 'invalid received quantity';end if;
select poi.id,poi.inventory_item_id,poi.unit,poi.quantity_ordered,poi.quantity_received into v_po_item from public.purchase_order_items poi where poi.id=v_item_id and poi.tenant_id=v_tenant_id and poi.purchase_order_id=p_purchase_order_id for update;
if not found then raise exception 'purchase order item not found';end if;
if v_qty>v_po_item.quantity_ordered-v_po_item.quantity_received then raise exception 'received quantity exceeds outstanding quantity';end if;
insert into public.inventory_receipt_items(tenant_id,receipt_id,purchase_order_item_id,quantity_received,unit) values(v_tenant_id,v_receipt_id,v_po_item.id,v_qty,v_po_item.unit);
insert into public.inventory_movements(tenant_id,inventory_item_id,movement_type,quantity,unit,purchase_order_id,receipt_id,created_by) values(v_tenant_id,v_po_item.inventory_item_id,'RECEIVE',v_qty,v_po_item.unit,p_purchase_order_id,v_receipt_id,auth.uid());
update public.purchase_order_items set quantity_received=quantity_received+v_qty where id=v_po_item.id and tenant_id=v_tenant_id;
v_count:=v_count+1;
end loop;
if v_count=0 then raise exception 'receipt cannot be empty';end if;
if exists(select 1 from public.purchase_order_items where purchase_order_id=p_purchase_order_id and tenant_id=v_tenant_id and quantity_received<quantity_ordered) then update public.purchase_orders set status='PARTIALLY_RECEIVED',updated_at=now() where id=p_purchase_order_id and tenant_id=v_tenant_id;else update public.purchase_orders set status='RECEIVED',updated_at=now() where id=p_purchase_order_id and tenant_id=v_tenant_id;end if;
return jsonb_build_object('receipt_id',v_receipt_id,'receipt_number',v_receipt_number,'idempotent',false);
exception when unique_violation then
select id,idempotency_fingerprint into v_receipt_id,v_existing_fingerprint from public.inventory_receipts where tenant_id=v_tenant_id and idempotency_key=v_key;
if v_existing_fingerprint<>v_fingerprint then raise exception 'idempotency key payload conflict';end if;
return jsonb_build_object('receipt_id',v_receipt_id,'idempotent',true);
end;$$;
revoke all on function public.receive_purchase_order(uuid,jsonb,text,text) from public;
grant execute on function public.receive_purchase_order(uuid,jsonb,text,text) to authenticated;
create or replace function public.transition_kitchen_order(p_order_id uuid,p_next_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant_id uuid:=public.current_tenant_id();v_role text:=public.current_profile_role()::text;v_current_status text;v_payment_status text;v_updated integer;v_order_item record;v_recipe_header record;v_ingredient record;v_locked_item_id uuid;v_required numeric;v_stock numeric;v_consumed integer:=0;
begin
if v_role<>'KITCHEN_ADMIN' or v_tenant_id is null then raise exception 'not authorized';end if;
if p_next_status not in('PREPARING','READY','COMPLETED') then raise exception 'invalid kitchen status';end if;
select order_status,payment_status into v_current_status,v_payment_status from public.orders where id=p_order_id and tenant_id=v_tenant_id for update;
if not found then raise exception 'order not found';end if;
if v_current_status=p_next_status then return jsonb_build_object('order_id',p_order_id,'order_status',v_current_status,'payment_status',v_payment_status,'idempotent',true);end if;
if v_payment_status<>'PAID' then raise exception 'order payment is not confirmed';end if;
if not((v_current_status='QUEUED' and p_next_status='PREPARING') or(v_current_status='PREPARING' and p_next_status='READY') or(v_current_status='READY' and p_next_status='COMPLETED')) then raise exception 'invalid kitchen transition';end if;
if v_current_status='QUEUED' and p_next_status='PREPARING' then
for v_order_item in select * from public.order_items where tenant_id=v_tenant_id and order_id=p_order_id order by id for update loop
select r.id,r.is_active into v_recipe_header from public.recipes r where r.tenant_id=v_tenant_id and r.product_id=v_order_item.product_id;
if found and v_recipe_header.is_active then
for v_ingredient in select ri.inventory_item_id,ri.quantity,ri.unit,ii.unit as inventory_unit,ii.is_active from public.recipe_items ri join public.inventory_items ii on ii.tenant_id=ri.tenant_id and ii.id=ri.inventory_item_id where ri.tenant_id=v_tenant_id and ri.recipe_id=v_recipe_header.id order by ri.inventory_item_id loop
if not v_ingredient.is_active or v_ingredient.unit<>v_ingredient.inventory_unit then raise exception 'recipe ingredient unavailable';end if;
select id into v_locked_item_id from public.inventory_items where id=v_ingredient.inventory_item_id and tenant_id=v_tenant_id for update;
v_required:=v_order_item.quantity*v_ingredient.quantity;
select coalesce(sum(case when movement_type in('RECEIVE','ADJUSTMENT_IN','RETURN','TRANSFER_IN') then quantity else -quantity end),0) into v_stock from public.inventory_movements where tenant_id=v_tenant_id and inventory_item_id=v_ingredient.inventory_item_id;
if v_stock<v_required then raise exception 'insufficient stock for ingredient';end if;
insert into public.inventory_consumption(tenant_id,order_id,order_item_id,recipe_id,inventory_item_id,quantity,unit) values(v_tenant_id,p_order_id,v_order_item.id,v_recipe_header.id,v_ingredient.inventory_item_id,v_required,v_ingredient.inventory_unit) on conflict(tenant_id,order_item_id,inventory_item_id) do nothing;
if found then insert into public.inventory_movements(tenant_id,inventory_item_id,movement_type,quantity,unit,order_id,order_item_id,created_by) values(v_tenant_id,v_ingredient.inventory_item_id,'CONSUME',v_required,v_ingredient.inventory_unit,p_order_id,v_order_item.id,auth.uid());v_consumed:=v_consumed+1;end if;
end loop;
end if;
end loop;
end if;
update public.orders set order_status=p_next_status,updated_at=now() where id=p_order_id and tenant_id=v_tenant_id and order_status=v_current_status and payment_status='PAID';
get diagnostics v_updated=row_count;
if v_updated<>1 then raise exception 'order changed during transition';end if;
return jsonb_build_object('order_id',p_order_id,'order_status',p_next_status,'payment_status','PAID','consumed_lines',v_consumed,'idempotent',false);
end;$$;
revoke all on function public.transition_kitchen_order(uuid,text) from public;
grant execute on function public.transition_kitchen_order(uuid,text) to authenticated;
