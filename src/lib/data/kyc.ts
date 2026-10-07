import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  requireCaller,
  requireKycReviewer,
  AuthError,
  KYC_REVIEWER_ROLES,
} from "@/lib/supabase/auth";
import { isStellarAccount } from "@/lib/stellar-address";
import { signAttestation, signRevocation } from "@/lib/managed-wallet";
import { notify, notifyAdmins } from "@/lib/data/notifications";
import { computeDetailsHash } from "@/lib/kyc/details-hash";

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
  /** The wallet this check clears, or null until the applicant attaches one. */
  stellar_address: string | null;
  document_type: string;
  document_expires_on: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string;
  created_at: string;
  updated_at: string;
}

const SubmissionInput = z.object({
  // Null when the applicant has no wallet yet: the documents are reviewed in
  // the meantime and the wallet is attached later (attachOwnKycWallet).
  stellarAddress: z.string().refine(isStellarAccount, "Not a Stellar account address").nullable(),
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

/**
 * Refuse an identity check for any wallet but the caller's linked one.
 *
 * A check names the wallet it clears. Once approved, that wallet is attested
 * on-chain and can launch vaults, so it has to be one the applicant has shown
 * they control. That is the wallet linked to their account, which only
 * linkWallet writes, after a signed challenge. Without this check, one person's
 * documents could clear somebody else's wallet. The write policies refuse it
 * too (20261006155050_kyc_wallet_optional_at_submit). Checking here first
 * gives the applicant a message they can act on instead of an RLS error.
 */
async function requireLinkedWallet(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  address: string,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("stellar_public_key")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not save KYC submission: ${error.message}`);
  if (!data?.stellar_public_key || data.stellar_public_key !== address) {
    throw new Error(
      "Your verification can only be attached to the wallet set up on your account, and this one isn't. " +
        "Set it up from your profile's Wallet tab, or submit without a wallet and attach one later.",
    );
  }
}

/** The identity panel in the admin console. */
const IDENTITY_PANEL = "/admin?view=identity";

/**
 * Tell the KYC reviewers a check is waiting, in the bell and by email. Nothing
 * told them before: a submission sat in the queue until someone happened to
 * open the panel.
 */
async function tellReviewers(title: string) {
  await notifyAdmins(
    title,
    "Documents are waiting to be checked. Review them from Identity Verification in the admin console.",
    undefined,
    KYC_REVIEWER_ROLES,
    { url: IDENTITY_PANEL, email: true },
  );
}

/**
 * File or resubmit the caller's own KYC.
 *
 * The row is written through the caller's own client, so RLS applies: the
 * insert policy pins user_id to the caller, forces status to pending, and
 * requires the address to be the caller's linked wallet. An argument claiming
 * to be someone else, or naming someone else's wallet, cannot get past the
 * database.
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
    if (parsed.stellarAddress) {
      await requireLinkedWallet(supabase, caller.userId, parsed.stellarAddress);
    }

    const { error } = await supabase
      .from("kyc_requests")
      .insert({ user_id: caller.userId, stellar_address: parsed.stellarAddress, ...details });

    if (error) {
      // The only unique key an applicant can collide with is another account's
      // stellar_address; their own row would have been found above.
      if (error.code === "23505") {
        throw new Error("That wallet already has an identity check on another account.");
      }
      // Until 20261006155050_kyc_wallet_optional_at_submit is applied, the
      // column is required and the policy compares it with the linked wallet,
      // so a check with no wallet is refused by one or the other.
      if (!parsed.stellarAddress && (error.code === "23502" || error.code === "42501")) {
        throw new Error(
          "Submitting before you have a wallet isn't switched on yet. Set up your wallet from your profile's Wallet tab, then submit.",
        );
      }
      throw new Error(`Could not save KYC submission: ${error.message}`);
    }
    await tellReviewers("New identity check to review");
    return;
  }

  if (existing.status === "approved") {
    throw new Error("Your identity check is already approved — there is nothing to resubmit.");
  }

  // stellar_address carries no UPDATE grant, so a resubmission cannot move an
  // existing record onto a different wallet. Say so rather than accept the
  // form and silently keep the old address.
  if (existing.stellar_address) {
    if (existing.stellar_address !== parsed.stellarAddress) {
      throw new Error(
        `Your verification is attached to the wallet ending ${existing.stellar_address.slice(-4)}. Switch to that wallet and set it up on your account again to resubmit, or contact support to move it.`,
      );
    }
    // The address on file must still be linked: removing a wallet from the
    // account unlinks it, so someone resubmitting afterwards links it again
    // first.
    await requireLinkedWallet(supabase, caller.userId, existing.stellar_address);
  }

  const { error } = await supabase
    .from("kyc_requests")
    .update(details)
    .eq("user_id", caller.userId);

  if (error) throw new Error(`Could not save KYC submission: ${error.message}`);

  // A check first filed without a wallet, resubmitted now that there is one.
  if (!existing.stellar_address && parsed.stellarAddress) {
    await attachOwnKycWallet();
  }
  await tellReviewers("An identity check was resubmitted");
}

/**
 * Attach the caller's linked wallet to their own identity check, which was
 * filed without one.
 *
 * Through the service role, because stellar_address has no UPDATE grant: a
 * browser-facing role must never be able to point a check at a wallet. What
 * this writes is exactly what the write policies would accept on an insert --
 * the caller's linked wallet, which linkWallet sets only after a signed
 * challenge -- and only onto the caller's own row, and only while it has no
 * wallet, so it can never move a check from one wallet to another.
 *
 * The details hash is recomputed with the address, so the commitment the
 * attestation puts on-chain binds the details to this wallet, as it does for a
 * check filed with one.
 *
 * An approved check gets its wallet here and still needs a reviewer to record
 * it on-chain, so they are told.
 */
export async function attachOwnKycWallet(): Promise<{
  address: string;
  status: ApplicantSubmission["status"];
}> {
  const caller = await requireCaller();
  const supabase = await createClient();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("stellar_public_key")
    .eq("id", caller.userId)
    .maybeSingle();
  if (profileError) throw new Error(`Could not attach your wallet: ${profileError.message}`);
  const linked = profile?.stellar_public_key ?? "";
  if (!isStellarAccount(linked)) {
    throw new Error("Set up your wallet from your profile's Wallet tab first, then attach it.");
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("kyc_requests")
    .select(
      "stellar_address, status, full_name, date_of_birth, document_type, id_number, document_expires_on, residential_address",
    )
    .eq("user_id", caller.userId)
    .maybeSingle();
  if (error) throw new Error(`Could not attach your wallet: ${error.message}`);
  if (!row) throw new Error("There's no identity check to attach a wallet to yet.");

  if (row.stellar_address) {
    if (row.stellar_address === linked) {
      return { address: linked, status: row.status as ApplicantSubmission["status"] };
    }
    throw new Error(
      `Your verification is already attached to the wallet ending ${row.stellar_address.slice(-4)}.`,
    );
  }

  const detailsHash = await computeDetailsHash({
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth ?? "",
    documentType: row.document_type,
    idNumber: row.id_number ?? "",
    documentExpiresOn: row.document_expires_on ?? "",
    residentialAddress: row.residential_address ?? "",
    stellarAddress: linked,
  });

  const { data: updated, error: updateError } = await admin
    .from("kyc_requests")
    .update({ stellar_address: linked, details_hash: detailsHash })
    .eq("user_id", caller.userId)
    .is("stellar_address", null)
    .select("status")
    .maybeSingle();
  if (updateError) {
    if (updateError.code === "23505") {
      throw new Error("That wallet already has an identity check on another account.");
    }
    throw new Error(`Could not attach your wallet: ${updateError.message}`);
  }
  if (!updated) throw new Error("Your verification changed while the wallet was being attached. Reload and try again.");

  if (updated.status === "approved") {
    await notifyAdmins(
      "An approved identity check is ready to record",
      "An applicant approved without a wallet has attached one. Record it from the identity panel so they can open a vault.",
      undefined,
      KYC_REVIEWER_ROLES,
      { url: IDENTITY_PANEL, email: true },
    );
  }

  return { address: linked, status: updated.status as ApplicantSubmission["status"] };
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
  /** For an approval: whether it is on-chain yet, or waits for the applicant's wallet. */
  recorded = true,
) {
  await requireKycReviewer();
  z.string().uuid().parse(submissionId);
  z.enum(["approved", "rejected"]).parse(decision);

  const admin = createAdminClient();
  const reason = decision === "rejected" ? rejectionReason.slice(0, 500) : "";

  // Returning the row serves two purposes: it confirms the update actually hit
  // a submission, and it yields the applicant to notify without a second read.
  const { data, error } = await admin
    .from("kyc_requests")
    .update({ status: decision, rejection_reason: reason })
    .eq("id", submissionId)
    .select("user_id")
    .maybeSingle();

  if (error) throw new Error(`Could not record KYC decision: ${error.message}`);
  if (!data) throw new Error("Could not record KYC decision: no such submission.");

  // Tell the applicant. Without this the decision was visible only to someone
  // who thought to revisit the verification page and read a step indicator --
  // an approved creator had no way to learn they were cleared. notify()
  // swallows its own failures, so a notification problem cannot undo a
  // decision that is already recorded.
  await notify({
    userId: data.user_id,
    title:
      decision === "rejected"
        ? "We couldn't verify your document"
        : recorded
          ? "Identity verified"
          : "Identity approved: one step left",
    caption:
      decision === "rejected"
        ? reason
          ? `${reason.replace(/[.\s]+$/, "")}. Upload a clearer copy and submit again.`
          : "Upload a clearer copy and submit again."
        : recorded
          ? "You can open a vault for your project."
          : "A reviewer approved your documents. Set up a wallet and attach it on the verification page to finish.",
    url: "/profile/kyc-attestation",
    // The applicant was told "we'll notify you by email".
    email: "account",
  });
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

  // Filed before the applicant had a wallet: the documents can be approved,
  // but there is no address to attest yet. attachOwnKycWallet tells the
  // reviewers when there is, and this same call then records it.
  if (!sub.stellar_address) {
    await decideSubmission(submissionId, "approved", "", false);
    return { address: null, attestor: me.managed_wallet };
  }

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

  // Nothing on-chain for a check that never had a wallet.
  if (sub.stellar_address) {
    await signRevocation({ keyRef: email, subject: sub.stellar_address });
  }
  await decideSubmission(submissionId, "rejected");

  return { address: sub.stellar_address };
}

export { AuthError };
