-- ============================================================
-- Travelers Inn · Migration 11: booking.settings
--
-- Key/value configuration the admin can edit without a deploy: GCash and bank
-- details shown to portal guests, the deposit percentage, and the inn's
-- address/coordinates for the map. Nothing secret is ever stored here — the
-- `is_public` rows are readable by anyone.
-- ============================================================

create table if not exists booking.settings (
  key text primary key,
  value text not null default '',
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

do $$ begin
  create trigger set_updated_at before update on booking.settings
    for each row execute function booking.set_updated_at();
exception when duplicate_object then null; end $$;

-- Seed. Address/coords carry a sentinel so the UI can hide the map until it is
-- configured; ON CONFLICT DO NOTHING keeps re-runs from clobbering real values.
insert into booking.settings (key, value, is_public) values
  ('gcash_name',          '',              true),
  ('gcash_number',        '',              true),
  ('bank_name',           '',              true),
  ('bank_account_name',   '',              true),
  ('bank_account_number', '',              true),
  ('deposit_percent',     '50',            true),
  ('inn_address',         'TODO_REPLACE',  true),
  ('inn_map_lat',         'TODO_REPLACE',  true),
  ('inn_map_lng',         'TODO_REPLACE',  true)
on conflict (key) do nothing;

alter table booking.settings enable row level security;

do $$ begin
  create policy settings_public_read on booking.settings for select using (is_public);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy settings_staff_read on booking.settings for select
    using (booking.fn_is_active_user());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy settings_admin_write on booking.settings for all
    using (booking.fn_is_admin())
    with check (booking.fn_is_admin());
exception when duplicate_object then null; end $$;
