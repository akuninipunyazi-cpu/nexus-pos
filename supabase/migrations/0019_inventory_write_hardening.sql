-- Phase 6.2 client-write hardening.
revoke insert,update,delete on public.recipes,public.recipe_items from authenticated;
revoke insert,update,delete on public.purchase_requests,public.purchase_request_items from authenticated;
revoke insert,update,delete on public.purchase_orders,public.purchase_order_items from authenticated;
revoke insert,update,delete on public.inventory_receipts,public.inventory_receipt_items from authenticated;
grant select on public.recipes,public.recipe_items,public.purchase_requests,public.purchase_request_items,public.purchase_orders,public.purchase_order_items,public.inventory_receipts,public.inventory_receipt_items to authenticated;

create or replace function public.record_inventory_adjustment(p_inventory_item_id uuid,p_movement_type text,p_quantity numeric,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant_id uuid:=public.current_tenant_id();v_role text:=public.current_profile_role()::text;v_item record;v_existing record;v_movement_id uuid;v_current_stock numeric:=0;v_key text:=trim(coalesce(p_idempotency_key,''));v_type text:=upper(trim(coalesce(p_movement_type,'')));v_reason text:=nullif(left(trim(coalesce(p_reason,'')),500),'');
begin
 if v_role not in('STORE_OWNER','KITCHEN_ADMIN') or v_tenant_id is null then raise exception 'not authorized';end if;
 if v_type not in('ADJUSTMENT_IN','ADJUSTMENT_OUT') then raise exception 'invalid adjustment type';end if;
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
 if v_type='ADJUSTMENT_OUT' and v_current_stock<p_quantity then raise exception 'insufficient stock';end if;
 insert into public.inventory_movements(tenant_id,inventory_item_id,movement_type,quantity,unit,reason,idempotency_key,created_by) values(v_tenant_id,p_inventory_item_id,v_type,p_quantity,v_item.unit,v_reason,v_key,auth.uid()) returning id into v_movement_id;
 return jsonb_build_object('movement_id',v_movement_id,'idempotent',false);
exception when unique_violation then
 select id,inventory_item_id,movement_type,quantity,reason into v_existing from public.inventory_movements where tenant_id=v_tenant_id and idempotency_key=v_key;
 if not found then raise;end if;
 if v_existing.inventory_item_id<>p_inventory_item_id or v_existing.movement_type<>v_type or v_existing.quantity<>p_quantity or v_existing.reason is distinct from v_reason then raise exception 'idempotency key payload conflict';end if;
 return jsonb_build_object('movement_id',v_existing.id,'idempotent',true);
end;$$;
revoke all on function public.record_inventory_adjustment(uuid,text,numeric,text,text) from public;
grant execute on function public.record_inventory_adjustment(uuid,text,numeric,text,text) to authenticated;

create or replace function public.create_purchase_request(p_items jsonb,p_supplier_id uuid default null,p_reason text default null,p_notes text default null,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant_id uuid:=public.current_tenant_id();v_role text:=public.current_profile_role()::text;v_user_id uuid:=auth.uid();v_key text:=trim(coalesce(p_idempotency_key,''));v_fp text:=md5(coalesce(p_items,'[]'::jsonb)::text||'|'||coalesce(p_supplier_id::text,'')||'|'||coalesce(p_reason,'')||'|'||coalesce(p_notes,''));v_id uuid;v_num text;v_old_fp text;v_item jsonb;v_inv record;v_qty numeric;v_count int:=0;
begin
 if v_role not in('STORE_OWNER','KITCHEN_ADMIN') or v_tenant_id is null then raise exception 'not authorized';end if;
 if char_length(v_key)<8 or char_length(v_key)>200 or p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'invalid purchase request';end if;
 if exists(select 1 from(select value->>'inventory_item_id' id from jsonb_array_elements(p_items))x group by id having count(*)>1) then raise exception 'duplicate request item';end if;
 if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and tenant_id=v_tenant_id and is_active) then raise exception 'supplier unavailable';end if;
 select id,request_number,idempotency_fingerprint into v_id,v_num,v_old_fp from public.purchase_requests where tenant_id=v_tenant_id and idempotency_key=v_key for update;
 if found then if v_old_fp<>v_fp then raise exception 'idempotency key payload conflict';end if;return jsonb_build_object('request_id',v_id,'request_number',v_num,'idempotent',true);end if;
 insert into public.purchase_requests(tenant_id,status,supplier_id,reason,notes,idempotency_key,idempotency_fingerprint,created_by) values(v_tenant_id,'SUBMITTED',p_supplier_id,nullif(left(trim(coalesce(p_reason,'')),500),''),nullif(left(trim(coalesce(p_notes,'')),1000),''),v_key,v_fp,v_user_id) returning id,request_number into v_id,v_num;
 for v_item in select value from jsonb_array_elements(p_items) loop
  begin v_qty:=(v_item->>'quantity')::numeric;select id,unit,is_active into v_inv from public.inventory_items where id=(v_item->>'inventory_item_id')::uuid and tenant_id=v_tenant_id;exception when invalid_text_representation then raise exception 'invalid request item';end;
  if v_qty is null or v_qty<=0 or not found or not v_inv.is_active then raise exception 'invalid request item';end if;
  insert into public.purchase_request_items(tenant_id,request_id,inventory_item_id,quantity,unit) values(v_tenant_id,v_id,v_inv.id,v_qty,v_inv.unit);v_count:=v_count+1;
 end loop;
 if v_count=0 then raise exception 'request cannot be empty';end if;
 return jsonb_build_object('request_id',v_id,'request_number',v_num,'idempotent',false);
exception when unique_violation then
 select id,request_number,idempotency_fingerprint into v_id,v_num,v_old_fp from public.purchase_requests where tenant_id=v_tenant_id and idempotency_key=v_key;
 if not found then raise exception 'duplicate request item';end if;
 if v_old_fp<>v_fp then raise exception 'idempotency key payload conflict';end if;
 return jsonb_build_object('request_id',v_id,'request_number',v_num,'idempotent',true);
end;$$;
revoke all on function public.create_purchase_request(jsonb,uuid,text,text,text) from public;
grant execute on function public.create_purchase_request(jsonb,uuid,text,text,text) to authenticated;