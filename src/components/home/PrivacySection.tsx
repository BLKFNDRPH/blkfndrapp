import { EyeOff, Fingerprint, Globe, KeyRound, Lock, Trash2, Users } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { AuditorAccordion } from "./AuditorAccordion";

/**
 * "How your personal data is protected": the companion to SecuritySection,
 * which covers money. Six plain cards, a list of what is public and what
 * isn't, and one collapsed disclosure with the mechanics and the audit.
 *
 * Every claim here is what the code does. docs/privacy.md is the reference,
 * and it is where a change to any of this gets written down first.
 */

const PROTECTIONS = [
  {
    icon: Users,
    title: "Stakeholders never show us an ID.",
    body: "Taking part needs a Stellar wallet, not a passport. Only builders verify their identity, so stakeholders know a real, checked person is behind a project.",
  },
  {
    icon: Trash2,
    title: "A builder's ID is deleted once it's checked.",
    body: "When a reviewer decides, the document and the ID number, date of birth, address and email typed with it are permanently deleted. If they approve before you've set up a wallet, those details go when you attach one.",
  },
  {
    icon: Fingerprint,
    title: "What's kept is a hash, not your details.",
    body: "The on-chain identity registry holds a one-way SHA-256 hash of the verified details. It proves the check happened, and it can't be turned back into them.",
  },
  {
    icon: EyeOff,
    title: "Only a reviewer sees your document, briefly.",
    body: "One case at a time, through a link that expires in five minutes, shown so their browser keeps no copy. Every decision runs on our server, never from a reviewer's browser.",
  },
  {
    icon: Lock,
    title: "It's never handed to anyone else.",
    body: "No outside verification company, no IPFS, no email attachments. Your document stays in a private store until it's deleted.",
  },
  {
    icon: KeyRound,
    title: "Your wallet keys stay with you.",
    body: "BLKFNDR never holds your wallet's private keys, so it can't sign a transaction that moves your stake or casts your vote.",
  },
];

/** What anyone can see, and what only you, or a reviewer for a moment, can. */
const VISIBILITY = [
  {
    what: "Your wallet address, stakes, votes and payouts",
    who: "Public. They're on the Stellar ledger, where anyone can check them. That's how a vault proves it kept its rules.",
    open: true,
  },
  {
    what: "Listings, their photos and milestone proof",
    who: "Public and permanent. They're stored on IPFS, where nothing can be deleted, so keep personal details out of a listing.",
    open: true,
  },
  {
    what: "The hash of a builder's verified details",
    who: "Public, on the on-chain identity registry. It can't be turned back into the details.",
    open: true,
  },
  {
    what: "Your display name and photo",
    who: "Shown to people signed in to BLKFNDR. A builder's name also appears on their projects.",
    open: true,
  },
  {
    what: "Your email and sign-in",
    who: "Private. Used to sign you in and, if you choose, to email you.",
    open: false,
  },
  {
    what: "A builder's ID document and details",
    who: "Seen only by a reviewer, then deleted.",
    open: false,
  },
];

export function PrivacySection() {
  return (
    <section
      id="privacy"
      className="relative scroll-mt-20 overflow-hidden border-t bg-background py-20 sm:py-28"
    >
      <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Privacy"
          title="How your personal data is protected"
          lead="We ask for as little as we can. Only builders show an ID, and only so stakeholders know who is behind a project. We keep the proof that the check happened and delete everything else."
        />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PROTECTIONS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex h-full flex-col rounded-xl border bg-card p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-headline text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          A builder&apos;s verification lasts as long as the ID it was approved on. We remind them 30 days
          before it expires, and they verify again with their current one.
        </p>

        {/* What is public, and what isn't */}
        <div className="mt-16 overflow-hidden rounded-xl border bg-card">
          <div className="border-b bg-muted/40 px-6 py-5">
            <h3 className="font-headline text-lg font-semibold sm:text-xl">What&apos;s public, and what isn&apos;t</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              A vault is open by design, so the money side is public. Who you are isn&apos;t.
            </p>
          </div>
          <ul className="divide-y">
            {VISIBILITY.map(({ what, who, open }) => (
              <li key={what} className="grid gap-2 px-6 py-5 sm:grid-cols-2 sm:gap-8">
                <div className="flex gap-3">
                  {open ? (
                    <Globe className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  )}
                  <span className="text-sm font-medium">
                    {what}
                    <span className="sr-only">{open ? " (public)" : " (private)"}</span>
                  </span>
                </div>
                <span className="pl-7 text-sm text-muted-foreground sm:pl-0">{who}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* The deletion mechanics and the audit live in here. */}
        <div className="mt-16">
          <AuditorAccordion
            title="For auditors and developers"
            intro="How the deletion works, who can reach identity data, and what the last audit found."
          >
            <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
              <div className="min-w-0 space-y-3 text-sm leading-relaxed text-muted-foreground">
                <h4 className="font-headline text-base font-semibold text-foreground">The mechanics</h4>
                <p>
                  A database trigger,{" "}
                  <code className="break-all rounded bg-muted px-1.5 py-0.5 font-code text-xs">
                    kyc_requests_drop_identity_after_decision
                  </code>
                  , clears the document&apos;s path on any decision. It clears the ID number, date of birth, address
                  and email once the hash is final. The file is deleted through the Storage API, and a sweep
                  removes any file no check points at.
                </p>
                <p>
                  The hash is SHA-256 of the name, date of birth, document type, ID number, expiry, address and
                  wallet address, written on-chain to the identity registry as the attestation. Anyone holding the same details can
                  recompute it. Nobody holding only the hash can recover them.
                </p>
                <p>
                  Identity columns are granted to no browser role, and no reviewer policy exists on the table. Every
                  read and decision runs on the server after a reviewer check. Documents are fetched with{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-code text-xs">cache: &quot;no-store&quot;</code>{" "}
                  and shown from memory that is released when the case closes.
                </p>
              </div>
              <div className="min-w-0 space-y-3 text-sm leading-relaxed text-muted-foreground">
                <h4 className="font-headline text-base font-semibold text-foreground">Audit, 7 October 2026</h4>
                <p>Run against the live platform:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>No ID document, ID number, date of birth, address or email remained for any decided check.</li>
                  <li>Every deleted document returned &ldquo;not found&rdquo; from storage itself, not just from the database.</li>
                  <li>213 database columns held no embedded images, PDFs or encoded files.</li>
                  <li>No version of the KYC code ever sent a document to IPFS, and the code history holds no ID images.</li>
                </ul>
              </div>
            </div>
          </AuditorAccordion>
        </div>
      </div>
    </section>
  );
}
