-- ============================================================
-- Travelers Inn · Migration 8: payments + derived payment status
--
-- Payments are recorded by staff (manual/cash model). A trigger keeps
-- bookings.payment_status derived from the sum of payments so the badge and
-- reports never drift from the ledger.
-- ============================================================

create type booking.payment_method as enum ('cash', 'gcash', 'card', 'bank_transfer', 'other');

create table booking.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references booking.bookings (id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0),
  method booking.payment_method not null default 'cash',
  reference text,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_booking_id_idx on booking.payments (booking_id);

alter table booking.payments enable row level security;
create policy payments_staff_read on booking.payments for select
  using (booking.fn_is_active_user());
create policy payments_staff_write on booking.payments for all
  using (booking.fn_is_active_user())
  with check (booking.fn_is_active_user());

-- Keep bookings.payment_status derived from the sum of payments.
create or replace function booking.fn_sync_payment_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_booking uuid := coalesce(new.booking_id, old.booking_id);
  v_paid numeric(10,2);
  v_total numeric(10,2);
begin
  select coalesce(sum(amount), 0) into v_paid from booking.payments where booking_id = v_booking;
  select quoted_total into v_total from booking.bookings where id = v_booking;
  update booking.bookings set payment_status =
    case when v_total is null then 'unpaid'
         when v_paid >= v_total and v_paid > 0 then 'paid'
         when v_paid > 0 then 'partial'
         else 'unpaid' end
  where id = v_booking;
  return null;
end;
$$;

create trigger sync_payment_status
  after insert or update or delete on booking.payments
  for each row execute function booking.fn_sync_payment_status();
