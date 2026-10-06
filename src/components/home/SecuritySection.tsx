import {
  Ban,
  Check,
  ExternalLink,
  FileCheck,
  Hash,
  Landmark,
  Lock,
  Timer,
  Users,
  X,
} from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { LiveVaultHash } from "./LiveVaultHash";
import { AuditorAccordion } from "./AuditorAccordion";
import { EXPLORER_BASE, EXPLORER_EXPLAINER, IS_PRACTICE_NETWORK } from "@/lib/network";

/**
 * "How your money is protected": six plain cards, the comparison table in plain
 * words, and one collapsed disclosure that holds everything an auditor needs.
 *
 * Nothing technical renders outside the disclosure: no hash, no address, no
 * shell command, no test name. The claims above it stay checkable because the
 * disclosure keeps every one of those artefacts on the page.
 */

const PROTECTIONS = [
  {
    icon: Landmark,
    title: "Your money is in the project's vault, not in a BLKFNDR account.",
    body: null,
  },
  {
    icon: Lock,
    title: "The vault has no button for us.",
    body: "Its code contains no instruction that lets BLKFNDR move money, and anyone can check that.",
  },
  {
    icon: Users,
    title: "The builder can't pay themselves.",
    body: "Each stage is paid only by a stakeholder vote. No single vote counts for more than 20%, and a payout needs at least three stakeholders, or all of them when fewer staked, who between them put in most of the money.",
  },
  {
    icon: Timer,
    title: "Going quiet returns the money.",
    body: "If a vote ends short, or nothing happens for 90 days, refunds open.",
  },
  {
    icon: Ban,
    title: "The builder's deposit is on the line.",
    body: "A failed stage hands it to stakeholders in proportion to their stakes.",
  },
  {
    icon: FileCheck,
    title: "Proof is stored where it can't be quietly swapped later,",
    body: "and every listing gets an automatic quality check before it goes live.",
  },
];

const BAD_BUILDER = [
  {
    needs: "A master key or team account that can take the money out",
    blkfndr:
      "There is none. Money leaves the vault only when stakeholders vote it out, and anyone can carry out a payout they approved.",
  },
  {
    needs: "All the money at once, before anything is built",
    blkfndr:
      "Money leaves one stage at a time, and the people who staked vote on each stage separately.",
  },
  {
    needs: "Nothing of their own at risk",
    blkfndr:
      "A builder's deposit locked in the same vault, handed to stakeholders if a stage fails.",
  },
  {
    needs: "One big stakeholder willing to wave a payout through",
    blkfndr:
      "No single vote counts for more than 20%, and a payout needs at least three stakeholders to say yes, or all of them when fewer staked. One stakeholder can never wave it through over the others.",
  },
  {
    needs: "Stakeholders who stop paying attention",
    blkfndr:
      "A vote that ends short fails the stage, and 90 days of silence opens refunds. Doing nothing returns money to stakeholders.",
  },
  {
    needs: "A clean slate for the next project",
    blkfndr:
      "A permanent public record of every project a builder has closed, and how it ended.",
  },
];

const CAP_EXAMPLE = [
  { approvers: "One wallet", weight: "60", outcome: "short", releases: false },
  {
    approvers: "Two wallets",
    weight: "120",
    outcome: "short — enough weight, only two wallets",
    releases: false,
  },
  {
    approvers: "Three wallets",
    weight: "180",
    outcome: "releases",
    releases: true,
  },
];

/*
 * The contracts named here come from the same build-time variables the app
 * runs on, so the list follows a redeploy. Hard-coded, it went on showing the
 * previous factory and registries after the 2026-10-07 cutover.
 */
const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID ?? "";

/*
 * Not a build variable: the app reads the treasury from the factory's fee
 * wallet. It changes only when the treasury is redeployed, which a new factory
 * forces, since the treasury takes its factory at construction.
 */
const TREASURY_ID = "CAGMEGMS6MS6ENADUWDRW3GQ4XRBDYFFKHMRFVDEBHFCZW7NRO3TQPZW";

const CONTRACTS = [
  {
    label: "Factory",
    id: FACTORY_ID,
  },
  {
    label: "Attestation registry",
    id: process.env.NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID ?? "",
  },
  {
    label: "Identity registry",
    id: process.env.NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID ?? "",
  },
  {
    label: "Treasury (fee destination + governance)",
    id: TREASURY_ID,
  },
  {
    label: "Operations Vault (governed gas budget)",
    id: process.env.NEXT_PUBLIC_BLKFNDR_OPERATIONS_CONTRACT_ID ?? "",
  },
  {
    label: "Admin roster (not in the release path)",
    id: process.env.NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID ?? "",
  },
].filter(({ id }) => id);

export function SecuritySection() {
  return (
    <section
      id="protection"
      className="relative scroll-mt-20 overflow-hidden border-t bg-background py-20 sm:py-28"
    >
      <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Protection"
          title="How your money is protected"
          lead="Most places that take your money ask you to trust the people running them. Here the vault's own rules do the work: nobody at BLKFNDR can pay the builder, hold back a refund or edit a project's history, because the vault has no way to let us."
        />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PROTECTIONS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex h-full flex-col rounded-xl border bg-card p-6"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-headline text-base font-semibold">
                {title}
              </h3>
              {body ? (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {/* What a bad builder needs, and what stops them here */}
        <div className="mt-16 overflow-hidden rounded-xl border bg-card">
          <div className="border-b bg-muted/40 px-6 py-5">
            <h3 className="font-headline text-lg font-semibold sm:text-xl">
              What a bad builder runs into
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Each row is something a builder would need in order to walk off
              with the money, and the rule here that takes it away.
            </p>
          </div>
          <ul className="divide-y">
            {BAD_BUILDER.map(({ needs, blkfndr }) => (
              <li
                key={needs}
                className="grid gap-4 px-6 py-5 sm:grid-cols-2 sm:gap-8"
              >
                <div className="flex gap-3">
                  <X
                    className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <span className="text-sm text-muted-foreground line-through decoration-destructive/40">
                    {needs}
                  </span>
                </div>
                <div className="flex gap-3">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-accent"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium">{blkfndr}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Everything technical lives in here, and only in here. */}
        <div className="mt-16">
          <AuditorAccordion
            title="For auditors and developers"
            intro="If you can read code, here is everything you need to check us: program fingerprints, contract addresses and the command that rebuilds them."
          >
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
              {/* The 20% cap, worked through */}
              <div className="min-w-0">
                <h4 className="font-headline text-base font-semibold">
                  The 20% cap, concretely
                </h4>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Three stakeholders put in 100 USDC each against a 300 USDC
                  goal. The cap is 20% of the goal, so each one counts for 60
                  regardless of what they actually staked. Together they count
                  for 180, so a payout needs more than 90 — from three wallets.
                </p>
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-4 font-semibold">Approvers</th>
                        <th className="pb-2 pr-4 font-semibold">Weight</th>
                        <th className="pb-2 font-semibold">Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {CAP_EXAMPLE.map(
                        ({ approvers, weight, outcome, releases }) => (
                          <tr key={approvers}>
                            <td className="py-2.5 pr-4 text-muted-foreground">
                              {approvers}
                            </td>
                            <td className="py-2.5 pr-4 font-code">{weight}</td>
                            <td
                              className={
                                releases
                                  ? "py-2.5 font-semibold text-accent"
                                  : "py-2.5 text-muted-foreground"
                              }
                            >
                              {outcome}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  The bar is half of what stakeholders can actually cast, not
                  half the goal. Weight above the cap can never be voted.
                  Measured against the goal, one or two stakeholders could never
                  release, even unanimously, and a builder who delivered would
                  lose their deposit.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  A stakeholder holding two thirds of the goal still counts for
                  60, and still cannot release alone. Put 200 against two
                  stakeholders of 50: the capped total is 160, so the bar is more
                  than 80. The large stakeholder and one other reach 110 — enough
                  weight, but two wallets, so nothing moves until the third
                  approves. Both properties are pinned down by the contract test
                  suite —{" "}
                  <code className="break-all rounded bg-muted px-1.5 py-0.5 font-code text-xs">
                    a_majority_contributor_cannot_release_alone
                  </code>{" "}
                  and{" "}
                  <code className="break-all rounded bg-muted px-1.5 py-0.5 font-code text-xs">
                    release_requires_at_least_three_distinct_wallets
                  </code>
                  .
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  With fewer than three stakeholders, every stakeholder must
                  approve. A sole stakeholder of the whole 300 counts for 60 of a
                  capped total of 60, so their one vote releases. Vaults are not
                  upgradeable: projects created before this rule keep the
                  earlier one.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  The stakeholders who say yes must also have put in more than
                  half the money between them, counted in full. Wallets cost
                  nothing to make, so without this, three wallets of 70 could
                  clear the bar over a stakeholder of 790 who counts for 200.
                  They hold 21% of the money, so nothing moves. A vote every
                  stakeholder approves always carries —{" "}
                  <code className="break-all rounded bg-muted px-1.5 py-0.5 font-code text-xs">
                    small_wallets_cannot_outvote_most_of_the_money
                  </code>
                  .
                </p>
              </div>

              {/* Verify it yourself */}
              <div className="min-w-0">
                <h4 className="font-headline text-base font-semibold">
                  Check it yourself
                </h4>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  The vault is not deployed as a single contract. Its wasm is
                  uploaded once and the factory instantiates one instance per
                  project from that hash, read live from the factory below. A
                  project&apos;s vault keeps the code that was current when it
                  was created, so an older project may run an earlier hash.
                </p>

                <div className="mt-5 rounded-lg border bg-muted/40 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Hash className="h-3.5 w-3.5" aria-hidden="true" />
                    blkfndr_vault.wasm — sha256, as the factory deploys it today
                  </div>
                  <LiveVaultHash
                    factoryExplorerUrl={`${EXPLORER_BASE}/contract/${FACTORY_ID}`}
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    Reproduce it from source with{" "}
                    <code className="break-all font-code">
                      bash scripts/build-contracts.sh
                    </code>
                    .
                  </p>
                </div>

                <p className="mt-5 text-xs text-muted-foreground">
                  Contract addresses. Each link opens the public record:{" "}
                  {EXPLORER_EXPLAINER}
                </p>
                <ul className="mt-3 space-y-2.5">
                  {CONTRACTS.map(({ label, id }) => (
                    <li key={id}>
                      <a
                        href={`${EXPLORER_BASE}/contract/${id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-accent/50 hover:bg-muted/40"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {label}
                          </span>
                          {/*
                            Wrapped rather than truncated: a 56-character address
                            under `white-space: nowrap` contributes its full width
                            to the grid track's minimum, which stretched this whole
                            row past the viewport on phones.
                          */}
                          <span className="block break-all font-code text-xs text-muted-foreground">
                            {id}
                          </span>
                        </span>
                        <ExternalLink
                          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-accent"
                          aria-hidden="true"
                        />
                      </a>
                    </li>
                  ))}
                </ul>

                <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                  {IS_PRACTICE_NETWORK
                    ? "Deployed to Stellar testnet. "
                    : "Deployed to the Stellar public network. "}
                  The vault&apos;s release rules alone are pinned by 56 passing
                  tests, with the treasury and operations vault adding 45 and 25
                  more.
                  {IS_PRACTICE_NETWORK
                    ? " Mainnet is planned and not yet deployed — treat anything on testnet as a live rehearsal, not a place to commit money you need back."
                    : null}
                </p>
              </div>
            </div>
          </AuditorAccordion>
        </div>
      </div>
    </section>
  );
}
