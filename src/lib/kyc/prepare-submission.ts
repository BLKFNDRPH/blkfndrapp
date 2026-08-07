"use client";

/**
 * Turns what the KYC form holds into what the submission actually takes.
 *
 * The form was written against the previous backend, which put the document
 * itself in the database as a base64 data URL. It now belongs in a private
 * Storage bucket, with Postgres holding only a path — so the identity document
 * is never in a table any query can reach, and is served to reviewers through a
 * short-lived signed URL instead.
 *
 * Deliberately not IPFS. Pinata is right for the project metadata and images
 * this app already pins there, which are meant to be public and permanent. A
 * passport scan is the opposite on both counts: a content address is a
 * permanent retrieval handle, and IPFS does not really offer deletion — which
 * matters the first time someone asks for their document to be erased.
 */

/**
 * Hand the document to the server, which stores it and returns only its path.
 *
 * This used to upload straight from the browser to Storage, and failed with
 * "new row violates row-level security policy". The request was reaching
 * Storage as `anon`: an access token can decode locally — so getClaims()
 * returns a subject and the code proceeds — while the Storage API rejects it as
 * expired and falls back to anonymous. The bucket's insert policy is
 * `to authenticated`, so the row is refused.
 *
 * Going through a route removes the dependency on a live browser session, and
 * the caller's identity is established there by verifying the JWT rather than
 * trusting a decoded copy of it.
 */
export async function uploadKycDocument(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch("/api/kyc-document", { method: "POST", body });

  let payload: { path?: string; error?: string } = {};
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body means something upstream failed before the route ran.
    throw new Error("Could not upload the document. Try again.");
  }

  if (!response.ok || !payload.path) {
    throw new Error(payload.error ?? "Could not upload the document.");
  }

  return payload.path;
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
