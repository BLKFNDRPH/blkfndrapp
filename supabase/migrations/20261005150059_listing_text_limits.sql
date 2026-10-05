-- Listing text limits (QA report QA-RPT-BLKFNDR-2026-10-04-BT, BUG-007).
--
-- The listing form, the upload route and the indexer keep a listing's text
-- within LISTING_LIMITS (src/lib/listing-limits.ts). These checks are the last
-- line: the factory is permissionless, so a vault can be deployed for any
-- metadata at all. The numbers here and there must match.
--
-- ORDER MATTERS. When the indexer fails to write an event it stops there and
-- retries it on every run, which stalls indexing for every project, not just
-- the one at fault. So:
--   1. Apply this only after the app whose indexer clamps to these limits
--      (PR #110) is deployed. The indexer before it copies text at any length.
--   2. Rows already over a limit are trimmed first, below. Postgres checks a
--      constraint on every later UPDATE of a row, NOT VALID or not, and the
--      indexer rewrites a project's title each time someone stakes in it.
--
-- The trimmed rows keep their full text in their metadata on IPFS. These
-- columns are the copy the site displays.

-- Cut at the last space within the limit, so no word is split, unless the text
-- has no space to cut at.
create function pg_temp.trim_to(t text, n int) returns text
language sql immutable as $$
  select case
    when char_length(t) <= n then t
    else left(coalesce(nullif(rtrim(regexp_replace(left(t, n + 1), '\s+\S*$', '')), ''), t), n)
  end
$$;

update public.projects
   set title       = pg_temp.trim_to(title, 80),
       tagline     = pg_temp.trim_to(tagline, 100),
       description = pg_temp.trim_to(description, 2000),
       location    = pg_temp.trim_to(location, 160)
 where char_length(title) > 80
    or char_length(tagline) > 100
    or char_length(description) > 2000
    or char_length(location) > 160;

update public.project_milestones
   set title       = pg_temp.trim_to(title, 80),
       description = pg_temp.trim_to(description, 500)
 where char_length(title) > 80
    or char_length(description) > 500;

-- char_length counts characters (code points), as the app's charCount does.
alter table public.projects
  add constraint projects_title_length       check (char_length(title) <= 80),
  add constraint projects_tagline_length     check (char_length(tagline) <= 100),
  add constraint projects_description_length check (char_length(description) <= 2000),
  add constraint projects_location_length    check (char_length(location) <= 160);

alter table public.project_milestones
  add constraint project_milestones_title_length       check (char_length(title) <= 80),
  add constraint project_milestones_description_length check (char_length(description) <= 500);

drop function pg_temp.trim_to(text, int);
