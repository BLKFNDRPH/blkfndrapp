import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCaller, requireAdmin, AuthError } from "@/lib/supabase/auth";
import { isStellarAccount } from "@/lib/stellar-address";

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
 */
export async function submitOwnKyc(input: unknown) {
  const caller = await requireCaller();
  const parsed = SubmissionInput.parse(input);

  const supabase = await createClient();
  const { error } = await supabase.from("kyc_requests").upsert(
    {
      user_id: caller.userId,
      stellar_address: parsed.stellarAddress,
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
      status: "pending",
      rejection_reason: "",
    },
    { onConflict: "stellar_address" },
  );

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
  await requireAdmin();

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
  await requireAdmin();
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
  await requireAdmin();
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

export { AuthError };
