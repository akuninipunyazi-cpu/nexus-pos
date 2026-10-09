-- Resolve pgcrypto functions explicitly for the public-order SECURITY DEFINER RPC.
-- Supabase installs pgcrypto in the non-user-writable `extensions` schema.
alter function public.create_public_order(text, text, jsonb, text, text)
  set search_path = public, extensions;

-- Keep the configured Partner identity present at the trusted service boundary.
create or replace function public.apply_midtrans_partner_notification(
  p_provider_order_id text, p_provider_transaction_id text, p_provider_status text,
  p_gross_amount text, p_currency text, p_partner_id text, p_merchant_id text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.order_payment_attempts%rowtype;
  v_account public.payment_accounts%rowtype;
  v_order public.orders%rowtype;
  v_amount numeric;
  v_next text;
  v_changed boolean := false;
begin
  if p_partner_id is null or char_length(p_partner_id) not between 1 and 100 then raise exception 'invalid notification'; end if;
  if p_provider_status not in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED') then
    return jsonb_build_object('accepted', true, 'ignored', true);
  end if;
  if p_currency <> 'IDR' or p_provider_order_id is null or p_merchant_id is null then raise exception 'invalid notification'; end if;
  begin v_amount := p_gross_amount::numeric; exception when others then raise exception 'invalid notification'; end;
  select * into v_attempt from public.order_payment_attempts a where a.provider_order_id = p_provider_order_id for update;
  if not found then raise exception 'transaction not found'; end if;
  select * into v_account from public.payment_accounts pa where pa.tenant_id = v_attempt.tenant_id for update;
  if not found or v_account.provider <> 'MIDTRANS_PARTNER' or v_account.provider_merchant_id <> p_merchant_id then raise exception 'merchant mismatch'; end if;
  if v_attempt.amount <> v_amount or v_attempt.currency <> p_currency then raise exception 'amount mismatch'; end if;
  if v_attempt.provider <> 'MIDTRANS_PARTNER' then raise exception 'provider mismatch'; end if;
  select * into v_order from public.orders o where o.id = v_attempt.order_id and o.tenant_id = v_attempt.tenant_id for update;
  if not found then raise exception 'order not found'; end if;
  if p_provider_status = 'PAID' then v_next := 'PAID';
  elsif v_attempt.status = 'PENDING' then v_next := p_provider_status;
  else v_next := v_attempt.status;
  end if;
  if v_attempt.status = 'PAID' then return jsonb_build_object('accepted', true, 'idempotent', true, 'order_id', v_order.id, 'tenant_id', v_order.tenant_id); end if;
  if v_next = 'PAID' then
    update public.order_payment_attempts set status = 'PAID', provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id), paid_at = coalesce(paid_at, now()), updated_at = now() where id = v_attempt.id;
    update public.payments set status = 'PAID', provider_payment_id = coalesce(p_provider_transaction_id, provider_payment_id), paid_at = coalesce(paid_at, now()), updated_at = now() where tenant_id = v_attempt.tenant_id and order_id = v_attempt.order_id;
    update public.orders set payment_status = 'PAID', order_status = case when order_status = 'PENDING_PAYMENT' then 'QUEUED' else order_status end, updated_at = now() where tenant_id = v_attempt.tenant_id and id = v_attempt.order_id;
    v_changed := true;
  elsif v_attempt.status = 'PENDING' and v_next in ('FAILED', 'EXPIRED', 'CANCELLED') then
    update public.order_payment_attempts set status = v_next, failure_reason = left(coalesce(p_provider_status, ''), 80), updated_at = now() where id = v_attempt.id;
    update public.payments set status = v_next, updated_at = now() where tenant_id = v_attempt.tenant_id and order_id = v_attempt.order_id and status = 'PENDING';
    update public.orders set payment_status = case when v_next = 'CANCELLED' then 'CANCELLED' else 'FAILED' end, updated_at = now() where tenant_id = v_attempt.tenant_id and id = v_attempt.order_id and order_status = 'PENDING_PAYMENT';
    v_changed := true;
  end if;
  return jsonb_build_object('accepted', true, 'idempotent', not v_changed, 'order_id', v_order.id, 'tenant_id', v_order.tenant_id, 'changed', v_changed);
end; $$;
revoke all on function public.apply_midtrans_partner_notification(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_midtrans_partner_notification(text, text, text, text, text, text, text) to service_role;
