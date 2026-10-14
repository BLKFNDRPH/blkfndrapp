import { cn } from "@/lib/utils";
import { WALLETLESS_APPROVAL_DAYS } from "@/lib/kyc/walletless";

/**
 * What happens to an applicant's identity details, at each point of a check.
 *
 * One component for the form and the status page, which used to say it in two
 * different ways: the form ended with what is kept (the name and a one-way
 * hash), the status page didn't (QA Cycle 7, BF-120). Every state now ends
 * with that sentence, because it is true in every state. What is deleted, and
 * when, follows kyc_requests_drop_identity_after_decision
 * (20261007130000): on the decision, or for an approval made before a wallet
 * is attached, once one is.
 */
export type PrivacyStage =
  /** Filling in the form, or submitted and waiting for a reviewer. */
  | "before-decision"
  /** Approved before a wallet was attached: the details wait for it. */
  | "approved-awaiting-wallet"
  /** Decided, and everything but the name and the hash is gone. */
  | "decided";

export function PrivacyStatement({
  stage,
  hasWallet,
  where,
  className,
}: {
  stage: PrivacyStage;
  /** Whether the check is, or will be, attached to a wallet. */
  hasWallet: boolean;
  /** The form speaks of after submitting; the status page of this page. */
  where: "form" | "status";
  className?: string;
}) {
  const kept = "We keep your name and a one-way SHA-256 hash of your details.";
  let text: string;
  if (stage === "before-decision") {
    const shown =
      where === "form"
        ? "Your name, ID number, date of birth and address are never shown on this page after you submit. Only a reviewer can see them."
        : "Your name, ID number, date of birth and address are never shown on this page. Only a reviewer can see them.";
    const deleted = hasWallet
      ? "Once they've decided, we delete your document, ID number, date of birth and address."
      : `Once they've decided, we delete your document. Your ID number, date of birth and address are deleted then too, or, if they approve before you've attached a wallet, once you attach one, and at the latest ${WALLETLESS_APPROVAL_DAYS} days after the approval.`;
    text = `${shown} ${deleted} ${kept}`;
  } else if (stage === "approved-awaiting-wallet") {
    text = `Your document has been deleted. Your ID number, date of birth and address are kept only until you attach your wallet, then deleted too. If no wallet is attached within ${WALLETLESS_APPROVAL_DAYS} days of the approval, they're deleted anyway and you'd submit again. ${kept}`;
  } else {
    text = `Your document, ID number, date of birth and address have been deleted. ${kept}`;
  }
  return <p className={cn("text-muted-foreground", className)}>{text}</p>;
}
