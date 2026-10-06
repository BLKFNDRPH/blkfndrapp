/**
 * A commitment to the identity details, committed on-chain by the attestation
 * as `kyc_hash`.
 *
 * Shared by the browser, at submission, and the server, which recomputes it
 * when a wallet is attached after submission, so both canonicalise the same
 * way. Pure, and Web Crypto exists in both.
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
