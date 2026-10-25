-- =============================================================================
-- Row Level Security
--
-- The browser only ever reads the public catalogue directly from Supabase.
-- Everything else (orders, payments, inventory) is written by the FastAPI
-- backend, which uses the service-role connection and therefore bypasses RLS.
--
-- If you later query Supabase directly from the frontend, these policies keep
-- one customer from ever seeing another customer's rows.
-- =============================================================================

alter table profiles            enable row level security;
alter table addresses           enable row level security;
alter table categories          enable row level security;
alter table products            enable row level security;
alter table coupons             enable row level security;
alter table orders              enable row level security;
alter table order_items         enable row level security;
alter table order_status_events enable row level security;
alter table payments            enable row level security;
alter table payment_events      enable row level security;
alter table inventory_movements enable row level security;
alter table admin_audit_logs    enable row level security;

-- Helper: is the caller staff? Defined security-definer so the policy can read
-- profiles without recursing into the profiles policies.
create or replace function is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()::text
      and p.role in ('staff', 'admin')
  );
$$;

-- ------------------------------- profiles -----------------------------------
drop policy if exists "profiles: read own" on profiles;
create policy "profiles: read own" on profiles
  for select using (id = auth.uid()::text or is_staff());

drop policy if exists "profiles: update own basic fields" on profiles;
create policy "profiles: update own basic fields" on profiles
  for update using (id = auth.uid()::text)
  with check (id = auth.uid()::text and role = (select role from profiles where id = auth.uid()::text));

drop policy if exists "profiles: staff manage" on profiles;
create policy "profiles: staff manage" on profiles
  for all using (is_staff()) with check (is_staff());

-- ------------------------------- addresses ----------------------------------
drop policy if exists "addresses: own" on addresses;
create policy "addresses: own" on addresses
  for all using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);

drop policy if exists "addresses: staff read" on addresses;
create policy "addresses: staff read" on addresses
  for select using (is_staff());

-- ------------------------------- catalogue ----------------------------------
drop policy if exists "categories: public read" on categories;
create policy "categories: public read" on categories for select using (true);

drop policy if exists "categories: staff write" on categories;
create policy "categories: staff write" on categories
  for all using (is_staff()) with check (is_staff());

drop policy if exists "products: public read active" on products;
create policy "products: public read active" on products
  for select using (is_archived = false or is_staff());

drop policy if exists "products: staff write" on products;
create policy "products: staff write" on products
  for all using (is_staff()) with check (is_staff());

-- Coupons are validated by the backend; customers must not enumerate them.
drop policy if exists "coupons: staff only" on coupons;
create policy "coupons: staff only" on coupons for all using (is_staff()) with check (is_staff());

-- ------------------------------- orders -------------------------------------
drop policy if exists "orders: read own" on orders;
create policy "orders: read own" on orders
  for select using (user_id = auth.uid()::text or is_staff());

drop policy if exists "orders: staff write" on orders;
create policy "orders: staff write" on orders
  for update using (is_staff()) with check (is_staff());

drop policy if exists "order_items: read own" on order_items;
create policy "order_items: read own" on order_items
  for select using (
    exists (select 1 from orders o where o.id = order_items.order_id and (o.user_id = auth.uid()::text or is_staff()))
  );

drop policy if exists "order_status_events: read own" on order_status_events;
create policy "order_status_events: read own" on order_status_events
  for select using (
    exists (select 1 from orders o where o.id = order_status_events.order_id and (o.user_id = auth.uid()::text or is_staff()))
  );

drop policy if exists "payments: read own" on payments;
create policy "payments: read own" on payments
  for select using (
    exists (select 1 from orders o where o.id = payments.order_id and (o.user_id = auth.uid()::text or is_staff()))
  );

-- Writes to the tables below are backend-only. With RLS enabled and no insert
-- policy, anon/authenticated JWTs cannot create orders, payments, stock
-- movements or audit entries directly — the API is the only door.

-- Explicitly revoke the anon grants Supabase adds by default for tables that
-- must never be visible in the browser.
revoke all on table payment_events      from anon, authenticated;
revoke all on table inventory_movements from anon, authenticated;
revoke all on table admin_audit_logs    from anon, authenticated;
grant select on table payment_events      to authenticated;  -- staff filter via RLS below
grant select on table inventory_movements to authenticated;
grant select on table admin_audit_logs    to authenticated;

drop policy if exists "payment_events: staff read" on payment_events;
create policy "payment_events: staff read" on payment_events for select using (is_staff());

drop policy if exists "inventory_movements: staff read" on inventory_movements;
create policy "inventory_movements: staff read" on inventory_movements for select using (is_staff());

drop policy if exists "admin_audit_logs: staff read" on admin_audit_logs;
create policy "admin_audit_logs: staff read" on admin_audit_logs for select using (is_staff());
