-- Email for notifications.
--
-- The bell only reaches someone who comes back to the site. A stakeholder who
-- doesn't visit during a seven-day vote never learns it opened, and money
-- waiting for them sits there. So a notification can also be emailed.
--
-- The notification row is the outbox: whoever creates it decides whether it is
-- also emailed by setting email_category, and the sender (the
-- notification-emails cron) works through the pending rows. A row that fails
-- stays pending for another try, and nothing older than a day is sent, so a
-- backlog that built up while email was switched off is never sent all at once.

alter table public.notifications
  -- Which email switch covers it. Null: in the bell only.
  --   votes   -- a vote that needs this person
  --   refunds -- money waiting for them
  --   updates -- payouts, goals reached, and a builder's own stakes and payments
  --   reviews -- work waiting for an admin role
  --   account -- their own account (identity result, a link they asked for);
  --              not switchable, since they started it
  add column email_category text
    check (email_category in ('votes', 'refunds', 'updates', 'reviews', 'account')),
  add column email_status text
    check (email_status in ('pending', 'sent', 'skipped', 'failed')),
  add column email_attempts smallint not null default 0,
  add column email_sent_at timestamptz,
  -- Why it was skipped or failed, for the operator. Never shown to anyone else.
  add column email_error text,
  add constraint notifications_email_status_with_category
    check ((email_category is null) = (email_status is null));

create index notifications_email_pending_idx
  on public.notifications (created_at)
  where email_status = 'pending';

-- The browser may mark its own notifications read and dismiss them, and
-- nothing else. 20260806191504 meant that already, with
-- `grant update (is_read)`, but both browser roles also held the table-wide
-- UPDATE every new table gets, so the column grant narrowed nothing: a
-- signed-in user could rewrite the title, caption, link and date of their own
-- notifications. With the email columns that would let them re-queue an email
-- to themselves over and over and use up the sending quota for everyone. So
-- the table-wide grant goes, the same fix as 20261007100549 for profiles. The
-- app's only browser write here is markRead (is_read); dismissing is a delete,
-- which keeps its own grant and policy.
revoke update on public.notifications from anon, authenticated;
grant update (is_read) on public.notifications to authenticated;


-- Who wants which emails. A missing row means every switch is on: the brief's
-- default, and the reason no backfill is needed.
create table public.email_preferences (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  votes             boolean not null default true,
  refunds           boolean not null default true,
  updates           boolean not null default true,
  reviews           boolean not null default true,
  -- In every email's unsubscribe link, so turning a switch off works from the
  -- inbox without signing in. Random, and not derived from anything public.
  unsubscribe_token uuid not null unique default gen_random_uuid(),
  updated_at        timestamptz not null default now()
);

create trigger email_preferences_touch_updated_at
  before update on public.email_preferences
  for each row execute function public.touch_updated_at();

-- Read and written only by the server: the settings actions after checking the
-- session, and the unsubscribe link by its token. RLS with no policies, and no
-- grants, so neither browser role can see a token.
alter table public.email_preferences enable row level security;
revoke all on public.email_preferences from anon, authenticated;


-- Notifications that must be produced once, keyed by what they are about. The
-- notification row can't carry that key: the person may dismiss it, and the
-- next run would then produce it again. Used for the "one day left to vote"
-- reminder, which is not a ledger event and is found by a scan that runs every
-- minute.
create table public.notification_once (
  key        text primary key,
  created_at timestamptz not null default now()
);

alter table public.notification_once enable row level security;
revoke all on public.notification_once from anon, authenticated;
