-- Admin-managed category list.
--
-- These were a hardcoded array in src/lib/categories.ts, so changing the list
-- meant a code change and a deploy. Moving them into a table lets an admin edit
-- the list without shipping.
--
-- projects.category stays a plain text column rather than becoming a foreign
-- key. That is deliberate: retiring a category should stop it being *offered*
-- to new projects, not rewrite or orphan the listings that already chose it. A
-- foreign key would force a decision — cascade, null out, or block the delete —
-- and all three are worse than letting an existing project keep the label it
-- was created with.

create table if not exists public.project_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- Case-insensitively unique. "Real Estate" and "real estate" as separate
  -- entries would split listings across two categories that read identically.
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists project_categories_name_lower_idx
  on public.project_categories (lower(name));

alter table public.project_categories enable row level security;

-- Readable by everyone, including signed-out visitors: the create-listing form
-- and the explore filters both need it, and a category name is not sensitive.
drop policy if exists project_categories_read on public.project_categories;
create policy project_categories_read
  on public.project_categories for select
  using (true);

-- Writable only by an admin. is_admin() reads app_metadata, which only the
-- service-role key can write, so this cannot be forged from a browser session.
drop policy if exists project_categories_admin_write on public.project_categories;
create policy project_categories_admin_write
  on public.project_categories for all
  using (public.is_admin())
  with check (public.is_admin());

-- RLS filters rows; it does not grant the verb. Without these the policies above
-- would never be reached.
grant select on public.project_categories to anon, authenticated;
grant insert, update, delete on public.project_categories to authenticated;

-- Seed from the list that was previously hardcoded, so nothing disappears from
-- the form the moment this lands.
insert into public.project_categories (name)
values
  ('Agriculture'), ('Animation'), ('Artificial Intelligence'), ('Blockchain'),
  ('Community'), ('Culture & Heritage'), ('E-commerce'), ('Education'),
  ('Environment'), ('Fashion & Design'), ('Film/Video'), ('Food & Beverage'),
  ('Gaming'), ('Hardware'), ('Healthcare'), ('Infrastructure & Energy'),
  ('Music'), ('Real Estate'), ('Services'), ('Smart Devices'), ('Software'),
  ('Sports'), ('Startups'), ('Tele-communications'), ('Transportation'),
  ('Visual Arts')
on conflict do nothing;

comment on table public.project_categories is
  'Categories offered when creating a listing. Admin-editable. projects.category is intentionally not a foreign key onto this table.';
