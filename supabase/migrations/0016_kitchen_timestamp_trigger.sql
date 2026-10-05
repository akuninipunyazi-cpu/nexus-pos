drop trigger if exists orders_state_timestamps on public.orders;
create trigger orders_state_timestamps
before insert or update of order_status on public.orders
for each row execute function public.set_order_state_timestamps();
