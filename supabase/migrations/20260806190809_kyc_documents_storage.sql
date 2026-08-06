-- Private storage for identity documents. Objects are laid out as
-- `<user_id>/<filename>`, so the first path segment identifies the owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kyc-documents', 'kyc-documents', false,
  10 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "an applicant uploads only under their own prefix"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "an applicant may replace their own pending document"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No select policy for any browser-facing role: reviewers reach documents
-- through signed URLs minted server-side. No delete policy: submissions are
-- not erasable by the submitter.
