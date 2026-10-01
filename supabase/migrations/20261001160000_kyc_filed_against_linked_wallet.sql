-- An identity check is filed against the applicant's linked wallet, and no
-- other.
--
-- Both write policies checked only that the row was the caller's own and
-- pending. stellar_address came from the browser, so anyone signed in could
-- file a check naming an address they had never shown they control, through
-- submitOwnKyc or straight against PostgREST. An attestor approving the
-- documents then attests that address on-chain, and the vault constructor
-- accepts it as a builder (is_kyc_approved(config.creator)). One person's
-- identity could clear somebody else's wallet.
--
-- profiles.stellar_public_key is the address a caller has proven: linkWallet
-- writes it only after a signed challenge, and it is unique. Both policies now
-- require stellar_address to equal it. With no linked wallet the comparison is
-- null, and the write is refused.
--
-- The proof is only as good as that column. It holds once
-- 20260809160000_profiles_column_grants is applied. Until then `authenticated`
-- can still write stellar_public_key directly.
--
-- On resubmission stellar_address cannot change (it has no UPDATE grant), so
-- the update check asks that the address on file still be the caller's linked
-- wallet. Signing out unlinks it, so an applicant resubmitting after a new
-- sign-in links that wallet again first.
--
-- Existing rows are untouched. On 2026-10-01 there were two, both approved,
-- and an approved check cannot be resubmitted.

alter policy "an applicant files their own submission"
  on public.kyc_requests
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and stellar_address = (
      select p.stellar_public_key from public.profiles p where p.id = (select auth.uid())
    )
  );

alter policy "an applicant may resubmit while unapproved"
  on public.kyc_requests
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and stellar_address = (
      select p.stellar_public_key from public.profiles p where p.id = (select auth.uid())
    )
  );
