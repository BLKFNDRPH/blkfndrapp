-- Count only the owners who are actually able to vote.
--
-- The threshold was two thirds of every row in platform_admins, but casting a
-- vote requires a user_id, and a row invited by email has none until its holder
-- first signs in. With three admins of whom one had signed in, approval needed
-- two votes while exactly one person could cast one: the threshold was
-- unreachable and every flagged listing would have stayed pending forever.
--
-- Found by running it rather than reading it. The arithmetic was right and the
-- population was wrong — which is the harder kind to see, because every test of
-- the maths passes.
--
-- Counting claimed rows only means an outstanding invitation neither blocks a
-- decision nor silently counts as a vote against one. An invited owner starts
-- counting toward the threshold at the moment they sign in, which is also the
-- first moment they could have acted on it.
create or replace function public.project_consensus(pid text)
returns table (approvals int, rejections int, owners int, needed int, carried boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with tally as (
    select
      count(*) filter (where v.approve)     as yes,
      count(*) filter (where not v.approve) as no
      from public.project_approval_votes v
     where v.project_id = pid
  ),
  roster as (
    select count(*)::int as n
      from public.platform_admins
     where user_id is not null
  )
  select
    tally.yes::int,
    tally.no::int,
    roster.n,
    ((roster.n * 2) + 2) / 3,
    (tally.yes * 3) >= (roster.n * 2)
  from tally, roster;
$$;

revoke execute on function public.project_consensus(text) from public, anon;
grant execute on function public.project_consensus(text) to authenticated;
