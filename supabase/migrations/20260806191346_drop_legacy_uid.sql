-- The old MongoDB is unreachable, so there are no accounts to reconcile and
-- nothing for this column to match against. Removing it rather than leaving a
-- permanently-null field that implies a linking step someone might later try.
drop index if exists public.profiles_legacy_uid_idx;
alter table public.profiles drop column if exists legacy_uid;
