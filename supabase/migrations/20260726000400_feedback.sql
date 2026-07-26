-- ============================================================
-- Travelers Inn · Migration 14: guest feedback
--
-- Guests scan a QR in their room and submit a rating. The table has NO anon
-- policy: submission goes only through fn_submit_feedback (SECURITY DEFINER),
-- called from a server action. That keeps the table unreachable from the
-- browser, so it can't be scraped or spammed by direct REST calls.
-- ============================================================

create table if not exists booking.feedback (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references booking.rooms (id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  guest_name text,
  created_at timestamptz not null default now()
);
create index if not exists feedback_room_id_idx on booking.feedback (room_id);
create index if not exists feedback_created_at_idx on booking.feedback (created_at desc);

alter table booking.feedback enable row level security;

-- Staff read only. No insert policy at all — see the header.
do $$ begin
  create policy feedback_staff_read on booking.feedback for select
    using (booking.fn_is_active_user());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy feedback_admin_delete on booking.feedback for delete
    using (booking.fn_is_admin());
exception when duplicate_object then null; end $$;

create or replace function booking.fn_submit_feedback(
  p_room_id uuid,
  p_rating int,
  p_comment text default null,
  p_guest_name text default null
) returns booking.feedback language plpgsql security definer set search_path = '' as $$
declare
  v_row booking.feedback;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Please choose a rating between 1 and 5.';
  end if;
  if not exists (select 1 from booking.rooms where id = p_room_id) then
    raise exception 'That room could not be found.';
  end if;

  insert into booking.feedback (room_id, rating, comment, guest_name)
  values (p_room_id, p_rating, nullif(btrim(p_comment), ''), nullif(btrim(p_guest_name), ''))
  returning * into v_row;
  return v_row;
end;
$$;
