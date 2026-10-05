create or replace function public.set_order_state_timestamps()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.order_status = 'QUEUED' and (tg_op = 'INSERT' or old.order_status is distinct from new.order_status) then
    new.queued_at := coalesce(new.queued_at, now());
  elsif new.order_status = 'PREPARING' and (tg_op = 'INSERT' or old.order_status is distinct from new.order_status) then
    new.preparing_at := coalesce(new.preparing_at, now());
  elsif new.order_status = 'READY' and (tg_op = 'INSERT' or old.order_status is distinct from new.order_status) then
    new.ready_at := coalesce(new.ready_at, now());
  elsif new.order_status = 'COMPLETED' and (tg_op = 'INSERT' or old.order_status is distinct from new.order_status) then
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;
