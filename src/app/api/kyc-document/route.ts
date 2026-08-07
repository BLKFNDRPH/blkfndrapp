import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCaller, AuthError } from "@/lib/supabase/auth";

/**
 * Upload an identity document to the private kyc-documents bucket.
 *
 * The browser used to write to Storage directly. That failed with "new row
 * violates row-level security policy", because the request reached Storage as
 * `anon` — an access token can decode locally, so getClaims() returns a subject,
 * and still be rejected as expired by the Storage API, which then falls back to
 * anonymous. The bucket's insert policy is `to authenticated`, so the row is
 * refused. Verified by simulating both roles against the real policy: the
 * authenticated insert passes, the anonymous one produces exactly that error.
 *
 * Doing it here removes the dependency on a live browser session entirely. The
 * caller is identified server-side by requireCaller, which verifies the JWT
 * signature rather than trusting a decoded copy of it.
 *
 * These documents deliberately do not go to IPFS with the project images.
 * Pinata is right for metadata that is meant to be public and permanent;
 * identity documents are the opposite on both counts. A content address is a
 * permanent retrieval handle, and "delete" is not something IPFS really offers
 * — which matters when someone asks for their passport scan to be erased.
 */

const BUCKET = "kyc-documents";

// Mirrors the bucket's own limits so a rejection is a clear message rather than
// a storage-layer error surfaced raw.
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/** Identify a document from its leading bytes; Content-Type is client-supplied. */
function sniff(bytes: Uint8Array): string | null {
  const at = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (at(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (
    at(0x52, 0x49, 0x46, 0x46) &&
    [8, 9, 10, 11].every((i, k) => bytes[i] === [0x57, 0x45, 0x42, 0x50][k])
  )
    return "image/webp";
  return null;
}

export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireCaller()).userId;
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return NextResponse.json({ error: "Unauthorized" }, { status });
  }

  let file: File | null = null;
  try {
    file = (await request.formData()).get("file") as File | null;
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No document provided." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Document must be ${MAX_BYTES / (1024 * 1024)}MB or smaller.` },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniff(bytes);
  if (!sniffed || !ALLOWED.has(sniffed)) {
    return NextResponse.json(
      { error: "Document must be a PNG, JPEG, WebP image or a PDF." },
      { status: 415 },
    );
  }

  // The prefix is the caller's own id, taken from the verified session rather
  // than from anything the request supplied. Even with the service-role client,
  // which bypasses RLS, a caller cannot write under someone else's prefix
  // because they never get to name it.
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" }[sniffed];
  const path = `${userId}/document-${Date.now()}.${extension}`;

  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: sniffed,
    // A resubmission replaces the previous document rather than accumulating
    // copies of someone's passport.
    upsert: true,
  });

  if (error) {
    console.error("[kyc] Document upload failed:", error.message);
    return NextResponse.json(
      { error: "Could not store the document. Try again." },
      { status: 500 },
    );
  }

  // Only the path leaves this route. The document itself is never returned, and
  // reviewers reach it through a short-lived signed URL instead.
  return NextResponse.json({ path });
}
