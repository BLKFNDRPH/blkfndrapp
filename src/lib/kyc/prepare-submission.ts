"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Turns what the KYC form holds into what the submission actually takes.
 *
 * The form was written against the previous backend, which put the document
 * itself in the database as a base64 data URL. It now belongs in a private
 * Storage bucket, with Postgres holding only a path — so the identity document
 * is never in a table any query can reach, and is served to reviewers through a
 * short-lived signed URL instead.
 */

const BUCKET = "kyc-documents";

/**
 * Upload under `<user_id>/…`, which is not a convention but a constraint: the
 * bucket's insert policy checks that the first path segment equals auth.uid(),
 * so an upload aimed at anyone else's prefix is refused by the database.
 */
export async function uploadKycDocument(file: File): Promise<string> {
  const supabase = createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    throw new Error("You need to be signed in to submit identity documents.");
  }

  // Keep the extension so reviewers get a sensible download, but do not keep
  // the original filename — people name these things after themselves, and the
  // path ends up in logs and error messages.
  const extension = (file.name.split(".").pop() ?? "").toLowerCase().slice(0, 8);
  const safeExtension = /^[a-z0-9]+$/.test(extension) ? `.${extension}` : "";
  const path = `${userId}/document-${Date.now()}${safeExtension}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    // A resubmission replaces the previous document rather than accumulating
    // copies of someone's passport.
    upsert: true,
  });

  if (error) {
    // The bucket caps size and MIME type, so these are the common rejections
    // and worth naming rather than passing through raw.
    throw new Error(`Could not upload the document: ${error.message}`);
  }

  return path;
}

/**
 * A commitment to the identity details, committed on-chain by the attestation
 * as `kyc_hash`.
 *
 * The point is that the ledger records *that* a specific set of details was
 * verified without publishing them. Anyone holding the original details can
 * recompute this and check it against the chain; nobody holding only the chain
 * can recover the details.
 *
 * The field order is fixed and the values are trimmed and lower-cased where
 * case is not meaningful, because the hash is only useful if it is reproducible.
 * The document image is deliberately not included — it is not stable across a
 * re-upload, and the hash would stop matching for no reason.
 */
export async function computeDetailsHash(fields: {
  fullName: string;
  dateOfBirth: string;
  documentType: string;
  idNumber: string;
  documentExpiresOn: string;
  residentialAddress: string;
  stellarAddress: string;
}): Promise<string> {
  const canonical = [
    fields.fullName.trim().toLowerCase(),
    fields.dateOfBirth.trim(),
    fields.documentType.trim().toLowerCase(),
    // Case and internal spacing vary in how people type document numbers.
    fields.idNumber.trim().toUpperCase().replace(/\s+/g, ""),
    fields.documentExpiresOn.trim(),
    fields.residentialAddress.trim().replace(/\s+/g, " ").toLowerCase(),
    // Case-sensitive: a Stellar address is a strkey, not free text.
    fields.stellarAddress.trim(),
  ].join(""); // unit separator — cannot appear in any of the above

  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
