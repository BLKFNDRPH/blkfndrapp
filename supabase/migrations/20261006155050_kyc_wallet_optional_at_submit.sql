-- An identity check can be filed before the applicant has a wallet, with the
-- wallet attached later. Still never a wallet they have not proven they hold.
--
-- Until now stellar_address was required and had to equal the caller's linked
-- wallet, so nobody could even start verifying their identity without first
-- installing a wallet extension and signing a link challenge. The passport
-- upload sat behind a crypto gate.
--
-- What this keeps: one person's documents can still never clear somebody
-- else's wallet. A row may now carry no address, and a row with no address
-- clears nothing. The attestation the vault constructor checks
-- (is_kyc_approved(config.creator)) is written for an address, so a reviewer can
-- approve the documents but has nothing to record on-chain until one is
-- attached. When an address is present, both write policies still require it
-- to be the caller's linked wallet: profiles.stellar_public_key, which
-- linkWallet writes only after a signed challenge.
--
-- Attaching a wallet later does not go through these policies. stellar_address
-- still has no UPDATE grant, so neither a resubmission nor a direct PostgREST
-- call can set or move it. The server attaches it with the service role
-- (attachOwnKycWallet in src/lib/data/kyc.ts): only the caller's linked
-- wallet, and only onto their own row while it has none.
--
-- The unique constraint on stellar_address is unchanged. Postgres treats NULLs
-- as distinct, so any number of rows can wait for a wallet.

alter table public.kyc_requests alter column stellar_address drop not null;

alter policy "an applicant files their own submission"
  on public.kyc_requests
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and (
      stellar_address is null
      or stellar_address = (
        select p.stellar_public_key from public.profiles p where p.id = (select auth.uid())
      )
    )
  );

-- On resubmission the address cannot change (no UPDATE grant), so this asks
-- that the address on file, if there is one, still be the caller's linked
-- wallet, exactly as before; a row still waiting for a wallet may be
-- resubmitted as it is.
alter policy "an applicant may resubmit while unapproved"
  on public.kyc_requests
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and (
      stellar_address is null
      or stellar_address = (
        select p.stellar_public_key from public.profiles p where p.id = (select auth.uid())
      )
    )
  );

comment on column public.kyc_requests.stellar_address is
  'The wallet this check clears once attested: always the applicant''s linked wallet. Null until they attach one; a null row clears nothing.';
