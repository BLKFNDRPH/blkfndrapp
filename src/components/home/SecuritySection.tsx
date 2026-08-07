import {
  Ban,
  Check,
  Database,
  ExternalLink,
  Hash,
  KeyRound,
  Lock,
  ScrollText,
  ShieldCheck,
  Timer,
  Users,
  X,
} from "lucide-react";
import { SectionHeading } from "./SectionHeading";

const PROTECTIONS = [
  {
    icon: Lock,
    title: "The bond exists before the vault does",
    body: "A builder's performance bond and the flat platform fee are taken in the very same transaction that creates the vault. There is no ordering in which a project can start collecting money before the builder has their own capital at risk. The minimum bond is 5% of the funding goal.",
  },
  {
    icon: Users,
    title: "Money moves only on a contributor vote",
    body: "A milestone tranche is released when more than 50% of the total raise votes to release it. Not a majority of voters — a majority of the money actually contributed. The builder can open the vote; they cannot decide it.",
  },
  {
    icon: Ban,
    title: "No single wallet can wave a release through",
    body: "However much one wallet puts in, it counts for at most 20% of the raise. Clearing a >50% threshold in 20% increments always takes at least three distinct wallets, so buying your own release is not a strategy that exists.",
  },
  {
    icon: Timer,
    title: "Silence returns money, it never releases it",
    body: "If the voting window lapses without a carrying vote, the milestone fails. Remaining funds and the forfeited bond become claimable pro-rata by contributors. Waiting out the contributors is the one strategy that costs a builder their bond.",
  },
  {
    icon: ScrollText,
    title: "The record cannot be edited afterwards",
    body: "Closing a project appends builder, outcome, raise, bond, milestones approved and timestamp to the attestation registry. That contract has no update entrypoint and no delete entrypoint — a bad outcome cannot be scrubbed before the next raise.",
  },
  {
    icon: Database,
    title: "Authorization enforced by the database",
    body: "Every table carries Row Level Security. Identity columns on KYC records are granted to no browser-facing role at all, identity documents live in a private bucket behind short-lived signed URLs, and roles are read from app_metadata, which a user cannot edit.",
  },
];

const RUG_COMPARISON = [
  {
    needs: "A team wallet or admin key that can withdraw",
    blkfndr:
      "No admin key anywhere in the path that moves money. Release is contributor-voted and permissionless.",
  },
  {
    needs: "Funds movable in one go, before anything is delivered",
    blkfndr:
      "Funds leave in milestone tranches, each one voted separately by the people who put the money in.",
  },
  {
    needs: "A builder with nothing of their own at stake",
    blkfndr:
      "A performance bond locked in the same contract as the raise, forfeited to contributors on a failed milestone.",
  },
  {
    needs: "One large holder to approve the exit",
    blkfndr:
      "A 20% weight cap per wallet, so a release always needs at least three distinct wallets behind it.",
  },
  {
    needs: "Contributor inattention to work in their favour",
    blkfndr:
      "A lapsed voting window fails the milestone. Doing nothing returns money to contributors.",
  },
  {
    needs: "A clean slate to start the next project on",
    blkfndr:
      "An append-only on-chain record of every project a builder has ever closed, and how it ended.",
  },
];

const CAP_EXAMPLE = [
  { approvers: "One wallet", weight: "60", outcome: "short", releases: false },
  { approvers: "Two wallets", weight: "120", outcome: "short", releases: false },
  {
    approvers: "Three wallets",
    weight: "180",
    outcome: "releases",
    releases: true,
  },
];

const CONTRACTS = [
  {
    label: "Factory",
    id: "CDIXGE5MWFAYXA7FKLB4CDRSSQZ6VQSGHT6O6OY3TFTWVF6F7BGKR7D5",
  },
  {
    label: "Attestation registry",
    id: "CDLL2A4RBSQPKSPTEE3O4HNSDICSJEGCHAWIGUYVRPGOKVEPJSNB2SO7",
  },
  {
    label: "Identity registry",
    id: "CAJGOVZ7DZTCVCBY44N24DDVEBEEMYSUIZFE3ZO5CDHWPGPF4QNLSGS7",
  },
  {
    label: "Admin roster (not in the release path)",
    id: "CAHAOAX52JAQ75C3INJIDVKT7EITWDVPYP2K27NJTD4CPYZUAU6WAGOG",
  },
];

const VAULT_WASM_HASH =
  "9c20bca3e364d26240f83f03c11bd40ee30092fa2520bb1e767ba2c9a596db41";

export function SecuritySection() {
  return (
    <section
      id="security"
      className="relative scroll-mt-20 overflow-hidden border-t bg-background py-20 sm:py-28"
    >
      <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Security & rugpull protection"
          title="There is no admin key in the path that moves money"
          lead="Most crowdfunding platforms ask you to trust that the people running them will behave. blkfndr removes the question. Nobody at the platform can release a tranche, withhold one, redirect a refund, or edit a builder's history — not because of policy, but because no entrypoint exists for it."
        />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PROTECTIONS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex h-full flex-col rounded-xl border bg-card p-6"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-headline text-base font-semibold">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </div>

        {/* What a rugpull needs, and what it runs into here */}
        <div className="mt-16 overflow-hidden rounded-xl border bg-card">
          <div className="border-b bg-muted/40 px-6 py-5">
            <h3 className="font-headline text-lg font-semibold sm:text-xl">
              What a rugpull needs, and what it runs into here
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Every row is a precondition an exit scam depends on, and the
              specific contract behaviour that removes it.
            </p>
          </div>
          <ul className="divide-y">
            {RUG_COMPARISON.map(({ needs, blkfndr }) => (
              <li
                key={needs}
                className="grid gap-4 px-6 py-5 sm:grid-cols-2 sm:gap-8"
              >
                <div className="flex gap-3">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <span className="text-sm text-muted-foreground line-through decoration-destructive/40">
                    {needs}
                  </span>
                </div>
                <div className="flex gap-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span className="text-sm font-medium">{blkfndr}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* The 20% cap, worked through */}
        <div className="mt-16 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
          <div className="min-w-0 rounded-xl border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <KeyRound className="h-5 w-5" />
              </span>
              <h3 className="font-headline text-lg font-semibold">
                The 20% cap, concretely
              </h3>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Three backers put in 100 USDC each against a 300 USDC goal. The cap
              is 20% of the raise, so each one counts for 60 regardless of what
              they actually contributed. A release needs more than 150.
            </p>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-semibold">Approvers</th>
                    <th className="pb-2 pr-4 font-semibold">Weight</th>
                    <th className="pb-2 font-semibold">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {CAP_EXAMPLE.map(({ approvers, weight, outcome, releases }) => (
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
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              A backer holding two thirds of the raise still counts for 60, and
              still cannot release alone. Both properties are pinned down by the
              contract test suite —{" "}
              <code className="break-all rounded bg-muted px-1.5 py-0.5 font-code text-xs">
                a_majority_contributor_cannot_release_alone
              </code>{" "}
              and{" "}
              <code className="break-all rounded bg-muted px-1.5 py-0.5 font-code text-xs">
                release_requires_at_least_three_distinct_wallets
              </code>
              .
            </p>
          </div>

          {/* Verify it yourself */}
          <div className="min-w-0 rounded-xl border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <h3 className="font-headline text-lg font-semibold">
                Check it yourself
              </h3>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              The vault is not deployed as a single contract. Its wasm is
              uploaded once and the factory instantiates one instance per project
              from that hash, so any project&apos;s vault can be checked against
              it.
            </p>

            <div className="mt-5 rounded-lg border bg-muted/40 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Hash className="h-3.5 w-3.5" />
                blkfndr_vault.wasm — sha256
              </div>
              <code className="mt-2 block break-all font-code text-xs leading-relaxed">
                {VAULT_WASM_HASH}
              </code>
              <p className="mt-3 text-xs text-muted-foreground">
                Reproduce it from source with{" "}
                <code className="break-all font-code">
                  bash scripts/build-contracts.sh
                </code>
                .
              </p>
            </div>

            <ul className="mt-5 space-y-2.5">
              {CONTRACTS.map(({ label, id }) => (
                <li key={id}>
                  <a
                    href={`https://stellar.expert/explorer/testnet/contract/${id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-accent/50 hover:bg-muted/40"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{label}</span>
                      {/*
                        Wrapped rather than truncated: a 56-character address
                        under `white-space: nowrap` contributes its full width to
                        the grid track's minimum, which stretched this whole row
                        past the viewport on phones.
                      */}
                      <span className="block break-all font-code text-xs text-muted-foreground">
                        {id}
                      </span>
                    </span>
                    <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-accent" />
                  </a>
                </li>
              ))}
            </ul>

            <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
              Deployed to Stellar testnet, with 81 contract tests passing.
              Mainnet is planned and not yet deployed — treat anything on testnet
              as a live rehearsal, not a place to commit funds you need back.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
