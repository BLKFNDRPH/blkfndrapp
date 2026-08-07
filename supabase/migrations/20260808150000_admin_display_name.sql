-- Admins are added with a name, an email and a wallet in one step.
--
-- The console showed "Unknown User" for every row because it resolved names from
-- a profile lookup keyed on wallet address, and an admin who has never signed in
-- has no profile to find. Asking for the name when the admin is created means the
-- roster can always say who someone is, including before they first sign in —
-- which is exactly when you most need to know who you just granted access to.
alter table public.platform_admins
  add column if not exists display_name text not null default '';

comment on column public.platform_admins.display_name is
  'Human name for the console roster. Recorded when the admin is added, because a profile lookup cannot name someone who has not signed in yet.';
