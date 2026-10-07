# Private data

What personal data BLKFNDR holds, where it lives, who can see it, how long it is kept, and how identity documents are destroyed. This is the reference for owners, reviewers, auditors and developers. The landing page's "How your personal data is protected" section says the same in plain words.

Last reviewed 2026-10-07, after the deletion audit described [below](#audit-2026-10-07).

## In short

- **Only builders verify their identity.** Stakeholders stake from a wallet and never hand over an ID.
- **An ID document is deleted once a reviewer decides.** The ID number, date of birth, home address and email typed with it are deleted at the same time. The one exception is an approval given before the builder has a wallet: those details stay until a wallet is attached, then go.
- **What stays is a fingerprint.** The public record holds a SHA-256 hash of the verified details and the wallet. It proves a check happened and can't be turned back into the details.
- **Only KYC reviewers see a document**, one case at a time, through a link that expires in five minutes, viewed so that their browser keeps no copy.
- **No outside verification company and no IPFS.** Identity documents stay in a private storage bucket until they are deleted.
- **Wallet keys stay with their owner.** The platform never holds a user's keys or controls their stake or vote ([non-custodial](contributing.md)).

## What is held, and for how long

| Data | Where | Who can see it | Kept |
|---|---|---|---|
| Sign-in account: email, and a password hash or the Google identity | Supabase Auth | The person, and the server | While the account exists |
| Profile: display name, avatar, linked wallet address | `profiles` | Any signed-in user, through address lookups (`PUBLIC_COLUMNS` in [src/lib/data/profiles.ts](../src/lib/data/profiles.ts)) | While the account exists |
| Identity check under review: name, email, ID number, date of birth, address, document type and expiry, and the document file | `kyc_requests` and the private `kyc-documents` bucket | KYC reviewers, through the server. The applicant sees only the status, document type, dates, wallet and any rejection reason | Until a reviewer decides |
| Identity check once decided: name, document type and expiry, fingerprint (`details_hash`), wallet, status, `verified_until` | `kyc_requests` | KYC reviewers. The applicant sees the status and dates | As the record of the check |
| Identity attestation: wallet and fingerprint | Identity registry, on the public Stellar ledger | Everyone | Until revoked. Ledger history keeps the attestation event permanently |
| Stakes, votes, payouts and refunds | Vault contracts, on the public ledger | Everyone | Permanently |
| Listings, their images and milestone proof photos | IPFS through Pinata | Everyone | Permanently. Nothing on IPFS can be deleted, so listings should carry no personal data |
| Notifications and email switches | `notifications`, `email_preferences` | The person | Until dismissed, or while the account exists |
| Notification emails, once email is switched on | Resend, as the sender | The recipient | Under Resend's retention |
| Wallet sign-in challenges | `auth_challenges` | The server only | Until used or expired, then purged |
| KYC reviewers' signing keys | Supabase Vault, encrypted | The server only | Until the reviewer is removed |

## Identity verification, end to end

### Upload

The document goes to `POST /api/kyc-document` ([route](../src/app/api/kyc-document/route.ts)). The file is identified by its bytes (PNG, JPEG, WebP or PDF, up to 10 MB), held in memory, and stored in the private `kyc-documents` bucket under the applicant's own account id, which comes from the session. It is never written to the server's disk and never sent to IPFS. The submission must name a file under the caller's own prefix ([src/lib/data/kyc.ts](../src/lib/data/kyc.ts)).

### Review

- Identity columns on `kyc_requests` are granted to no browser role. Reviewers read them through the service-role client, one case at a time, after `requireKycReviewer()`.
- A reviewer's own browser session has no access to anyone else's check. The KYC-manager policies were removed in [20261007170000](../supabase/migrations/20261007170000_kyc_review_server_only.sql), so every list, read and decision runs on the server.
- The document is reached through a signed URL that lasts five minutes. Supabase Storage serves signed URLs without a `Cache-Control` header, so the review panel fetches the file with `cache: "no-store"` and shows it from an in-memory object URL that is revoked when the case closes ([CaseDocument](../src/components/admin/CaseDocument.tsx)). It never uses `next/image`, whose optimizer would cache the file on the server.
- The applicant never sees their ID details again, not even on their own verification page.

### Decision and deletion

When a reviewer approves, the server writes the attestation on chain first, then records the decision. The `kyc_requests_drop_identity_after_decision` trigger ([20261007130000](../supabase/migrations/20261007130000_kyc_identity_deleted_after_decision.sql)) then clears:

- **`document_path`, on any decision.** The fingerprint never covered the image.
- **`email`, `id_number`, `date_of_birth`, `residential_address`, once the fingerprint is final.** That is on a rejection, or on an approval with a wallet. An approval given before the applicant has a wallet keeps them until one is attached, because the fingerprint is recomputed with the wallet. The update that attaches it then clears them.

SQL can't delete Storage objects (`storage.objects` has `protect_objects_delete`), so `deleteUnusedKycDocuments` deletes the file through the Storage API. It runs after every decision and every submission. `kyc_documents_to_delete(for_user)` lists every file no check points at: the applicant's at once, and anyone else's an hour after upload. The second half catches replaced uploads, abandoned ones, failed deletes and the files of deleted accounts.

The rule is a trigger, so every write path follows it, including edits made in the dashboard. Details: [authentication.md](authentication.md#deletion-after-the-decision).

### Renewal

A verification holds until the ID it was approved on expires (`verified_until`, [20261007150000](../supabase/migrations/20261007150000_kyc_renewal_before_id_expires.sql)). From 30 days before that date the builder can verify again with a current ID, and they are reminded. Approving the renewal replaces the fingerprint on chain, and the new document is deleted like the first. Past the date, the verification no longer counts in the app, and reviewers are told to revoke it. Details: [authentication.md](authentication.md#renewal-when-the-id-expires).

### Checking someone against the record

With the documents gone, a reviewer can still confirm who holds a verified wallet. In **Approved Creators**, *See details* shows what is kept, and *Check a person against this record* asks for the ID number, date of birth and address from an ID the person shows again. The browser recomputes the fingerprint and compares it with the one on chain. Nothing typed leaves the reviewer's browser ([RecordCheckDialog](../src/components/admin/RecordCheckDialog.tsx)).

## What is never done

- Identity documents are never stored in the database, never sent to IPFS and never shared with an outside verification service.
- Identity details are never shown back to the applicant, and never sent in notifications or emails. Emails carry no attachments.
- The server never logs a document's contents. The upload route logs only an error message, and request logs record file paths, not files.
- No platform key can move a stakeholder's money or cast their vote.

## Backups and copies outside the system

- **Database backups.** Supabase's database backups keep deleted text, such as the ID details cleared on 2026-10-07, until they roll off on the plan's schedule. They hold no identity documents: Storage files are not part of database backups, and documents have never been stored in the database.
- **Reviewers' devices.** Screenshots, downloads or notes a reviewer makes are outside the system. Reviewers should not keep any.

## Audit 2026-10-07

The deletion audit ran against live production on 2026-10-07. Everything the app controls was clean:

- The `kyc-documents` bucket held one file, belonging to the one check under review, and none for the 13 decided checks.
- Every document path of a decided check in the last 24 hours of logs returned 404 from Storage, with signed links refused.
- Each decision since the deploy ran the deletion step, and the deletes succeeded.
- No decided check holds a document link, ID number, date of birth, address or email.
- 213 text, JSON and binary columns across the `public`, `auth`, `storage` and `vault` schemas held no embedded images, PDFs or base64 data.
- No version of the KYC code ever sent documents to IPFS, and the repository history holds no ID images.

The browser-cache gap the audit found was fixed in #147.

## Open items

1. **Legacy MongoDB Atlas.** From 2026-07-17 to 2026-08-07 the app ran on MongoDB. Its KYC form stored the ID image itself, as base64, in the `documentImage` field of a `KycRequest` collection. Those records were never moved to Supabase. An owner needs to check in Atlas whether the cluster still exists, and if it does, delete the collection or the cluster along with its snapshots.
2. **One encrypted private file on Pinata,** pinned 2026-07-21. No version of this app made private or encrypted uploads, so it most likely belongs to another project on the same account. Confirm with whoever uploaded it.
3. **Display name fallback.** When an account is created with no name, `handle_new_user` sets the display name to the email address. Display names are visible to signed-in users. No live profile shows an email today (0 of 21 on 2026-10-07), but the fallback should not use the email.
4. **No account deletion in the app.** It is done in the Supabase dashboard. That removes the profile and the identity check with it. Any leftover document file is deleted by the next KYC submission or decision, once it is an hour old.
