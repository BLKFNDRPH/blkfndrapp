import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCaller, requireKycReviewer, AuthError } from "@/lib/supabase/auth";
import { isStellarAccount } from "@/lib/stellar-address";
import { signAttestation, signRevocation } from "@/lib/managed-wallet";

/**
 * KYC data access.
 *
 * Every function here re-authorizes. None of them assume the caller already
 * did — that assumption is what produced an anonymous read of every identity
 * document in the Mongo version.
 *
 * Identity columns are not granted to any browser-facing role, so reading them
 * requires the service-role client. Those reads live in `getSubmissionForReview`
 * and nowhere else.
 */

/** What an applicant is allowed to learn about their own submission. */
const APPLICANT_COLUMNS =
  "id, user_id, stellar_address, document_type, document_expires_on, status, rejection_reason, created_at, updated_at";

export interface ApplicantSubmission {
  id: string;
  user_id: string;
  stellar_address: string;
  document_type: string;
  document_expires_on: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string;
  created_at: string;
  updated_at: string;
}

const SubmissionInput = z.object({
  stellarAddress: z.string().refine(isStellarAccount, "Not a Stellar account address"),
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  documentType: z.enum(["passport", "drivers_license", "national_id"]),
  documentPath: z.string().trim().min(1).max(1024),
  idNumber: z.string().trim().min(1).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  documentExpiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  residentialAddress: z.string().trim().min(1).max(500),
  detailsHash: z.string().trim().length(64),
  consentGiven: z.literal(true, {
    errorMap: () => ({ message: "Consent is required to submit identity documents" }),
  }),
});

export type SubmissionInput = z.infer<typeof SubmissionInput>;

/**
 * File or resubmit the caller's own KYC.
 *
 * The row is written through the caller's own client, so RLS applies: the
 * insert policy pins user_id to the caller and forces status to pending. An
 * argument claiming to be someone else cannot get past the database.
 *
 * Deliberately not an upsert. PostgREST compiles `.upsert()` into
 * INSERT ... ON CONFLICT DO UPDATE, and Postgres requires SELECT privilege on
 * every column that statement assigns. This role holds UPDATE but not SELECT on
 * the identity columns — the withholding that makes this table safe — so the
 * statement was refused outright, before RLS was consulted, and no submission
 * ever landed. A plain UPDATE carries no such requirement, so the two cases are
 * separated here.
 */
export async function submitOwnKyc(input: unknown) {
  const caller = await requireCaller();
  const parsed = SubmissionInput.parse(input);

  const supabase = await createClient();

  // rejection_reason is absent on purpose: the applicant has no grant on it.
  // A new row gets '' by default, and a resubmission is cleared by the
  // kyc_requests_clear_rejection_reason trigger.
  const details = {
    full_name: parsed.fullName,
    email: parsed.email,
    document_type: parsed.documentType,
    document_path: parsed.documentPath,
    id_number: parsed.idNumber,
    date_of_birth: parsed.dateOfBirth,
    document_expires_on: parsed.documentExpiresOn,
    residential_address: parsed.residentialAddress,
    details_hash: parsed.detailsHash,
    consent_given: parsed.consentGiven,
    status: "pending" as const,
  };

  const { data: existing, error: readError } = await supabase
    .from("kyc_requests")
    .select("stellar_address, status")
    .eq("user_id", caller.userId)
    .maybeSingle();

  if (readError) throw new Error(`Could not save KYC submission: ${readError.message}`);

  if (!existing) {
    const { error } = await supabase
      .from("kyc_requests")
      .insert({ user_id: caller.userId, stellar_address: parsed.stellarAddress, ...details });

    if (error) {
      // The only unique key an applicant can collide with is another account's
      // stellar_address; their own row would have been found above.
      if (error.code === "23505") {
        throw new Error("That Stellar address is already registered to another account.");
      }
      throw new Error(`Could not save KYC submission: ${error.message}`);
    }
    return;
  }

  if (existing.status === "approved") {
    throw new Error("Your identity check is already approved — there is nothing to resubmit.");
  }

  // stellar_address carries no UPDATE grant, so a resubmission cannot move an
  // existing record onto a different account. Say so rather than accept the
  // form and silently keep the old address.
  if (existing.stellar_address !== parsed.stellarAddress) {
    throw new Error(
      `This identity check is filed against ${existing.stellar_address}. Reconnect that wallet to resubmit, or contact support to change it.`,
    );
  }

  const { error } = await supabase
    .from("kyc_requests")
    .update(details)
    .eq("user_id", caller.userId);

  if (error) throw new Error(`Could not save KYC submission: ${error.message}`);
}

/**
 * Status of the caller's own submission.
 *
 * Returns status fields only — the column grants make anything else
 * unreadable through this client regardless of what is asked for.
 */
export async function getOwnSubmission(): Promise<ApplicantSubmission | null> {
  const caller = await requireCaller();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kyc_requests")
    .select(APPLICANT_COLUMNS)
    .eq("user_id", caller.userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read KYC status: ${error.message}`);
  return (data as ApplicantSubmission | null) ?? null;
}

/** Queue for the admin console. Identity fields deliberately excluded. */
export async function listSubmissionsForReview(
  status?: "pending" | "approved" | "rejected",
) {
  await requireKycReviewer();

  const admin = createAdminClient();
  let query = admin
    .from("kyc_requests")
    .select("id, user_id, stellar_address, document_type, status, rejection_reason, created_at")
    .order("created_at", { ascending: true });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw new Error(`Could not list KYC submissions: ${error.message}`);
  return data ?? [];
}

/**
 * Full record for one submission, including identity fields and a short-lived
 * signed URL for the document.
 *
 * The only place identity data is read. Admin-only, one record at a time — a
 * reviewer opening a case, never a bulk export.
 */
export async function getSubmissionForReview(submissionId: string) {
  await requireKycReviewer();
  z.string().uuid().parse(submissionId);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("kyc_requests")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle();

  if (error) throw new Error(`Could not read KYC submission: ${error.message}`);
  if (!data) return null;

  const { data: signed, error: signError } = await admin.storage
    .from("kyc-documents")
    // Long enough to review, short enough that a leaked URL expires quickly.
    .createSignedUrl(data.document_path, 60 * 5);

  if (signError) {
    console.error("[kyc] Could not sign document URL:", signError.message);
  }

  return { ...data, documentUrl: signed?.signedUrl ?? null };
}

export async function decideSubmission(
  submissionId: string,
  decision: "approved" | "rejected",
  rejectionReason = "",
) {
  await requireKycReviewer();
  z.string().uuid().parse(submissionId);
  z.enum(["approved", "rejected"]).parse(decision);

  const admin = createAdminClient();
  const { error } = await admin
    .from("kyc_requests")
    .update({
      status: decision,
      rejection_reason: decision === "rejected" ? rejectionReason.slice(0, 500) : "",
    })
    .eq("id", submissionId);

  if (error) throw new Error(`Could not record KYC decision: ${error.message}`);
}

/**
 * Approve a submission by writing its attestation on-chain, signed by the
 * reviewer's platform-managed key — no wallet, no Freighter.
 *
 * This is the walletless path a KYC attestor works through every day: they open
 * a case, decide, and the server signs the attestation with the key it holds for
 * them. The key must already be appointed on the registry — an owner does that
 * once, from their own wallet — or the chain rejects the write, which is the
 * error the reviewer sees.
 *
 * The chain write comes before the database decision on purpose: a failed attest
 * must not leave a submission marked approved that the ledger never recorded.
 */
export async function attestSubmission(submissionId: string) {
  const caller = await requireKycReviewer();
  z.string().uuid().parse(submissionId);

  const email = (caller.email ?? "").toLowerCase();
  if (!email) throw new Error("Your account has no email to bind a signing key to.");

  const admin = createAdminClient();

  // Confirm the reviewer holds a managed key before touching the submission, so
  // someone without one gets a plain reason rather than a contract error.
  const { data: me } = await admin
    .from("platform_admins")
    .select("managed_wallet")
    .eq("email", email)
    .maybeSingle();
  if (!me?.managed_wallet) {
    throw new Error(
      "You do not have a managed attestor key. An owner grants one by adding you as a KYC Attestor.",
    );
  }

  const { data: sub, error } = await admin
    .from("kyc_requests")
    .select("stellar_address, details_hash")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw new Error(`Could not read KYC submission: ${error.message}`);
  if (!sub) throw new Error("That submission does not exist.");

  try {
    await signAttestation({
      keyRef: email,
      subject: sub.stellar_address,
      kycHashHex: sub.details_hash,
    });
  } catch (err) {
    // Already attested on a prior attempt whose database write did not land —
    // the ledger is where it needs to be, so sync the decision rather than
    // refuse. Any other failure still stops us marking it approved.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/AlreadyAttested|#12/i.test(msg)) throw err;
  }
  await decideSubmission(submissionId, "approved");

  return { address: sub.stellar_address, attestor: me.managed_wallet };
}

/** The managed attestor key the platform holds for the current reviewer, or
 *  null. The panel uses it to decide whether to offer walletless attestation. */
export async function myManagedAttestor(): Promise<string | null> {
  const caller = await requireKycReviewer();
  const email = (caller.email ?? "").toLowerCase();
  if (!email) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_admins")
    .select("managed_wallet")
    .eq("email", email)
    .maybeSingle();
  return data?.managed_wallet ?? null;
}

/** Revoke a submission's attestation on-chain with the reviewer's managed key,
 *  then mark it rejected. The mirror of attestSubmission. */
export async function revokeSubmissionAttestation(submissionId: string) {
  const caller = await requireKycReviewer();
  z.string().uuid().parse(submissionId);

  const email = (caller.email ?? "").toLowerCase();
  const admin = createAdminClient();
  const { data: me } = await admin
    .from("platform_admins")
    .select("managed_wallet")
    .eq("email", email)
    .maybeSingle();
  if (!me?.managed_wallet) {
    throw new Error("You do not have a managed attestor key.");
  }

  const { data: sub, error } = await admin
    .from("kyc_requests")
    .select("stellar_address")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw new Error(`Could not read KYC submission: ${error.message}`);
  if (!sub) throw new Error("That submission does not exist.");

  await signRevocation({ keyRef: email, subject: sub.stellar_address });
  await decideSubmission(submissionId, "rejected");

  return { address: sub.stellar_address };
}

export { AuthError };
