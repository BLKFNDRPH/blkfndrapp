-- Private storage for identity documents.
--
-- The Mongo version kept ID scans as base64 strings inside the row, so any
-- query that returned the row returned the document. Here the bucket is
-- private, objects are reachable only through short-lived signed URLs minted
-- server-side, and an applicant can write their own document but never read
-- anyone's -- including, deliberately, their own.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kyc-documents',
  'kyc-documents',
  false,
  10 * 1024 * 1024, -- 10 MB; a photo of an ID, not a video
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are laid out as `<user_id>/<filename>`, so the first path segment is
-- the owner and policies can key off it.

create policy "an applicant uploads only under their own prefix"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "an applicant may replace their own pending document"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No select policy for any browser-facing role. Reviewers reach documents
-- through signed URLs minted server-side with the service-role key after an
-- admin check; an applicant has no reason to re-download their own scan, and
-- not granting it removes an exfiltration path that XSS would otherwise have.
--
-- No delete policy: submissions are not erasable by the submitter. Removal on
-- a retention schedule is a server-side job.
