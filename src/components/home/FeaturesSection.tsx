import {
  Boxes,
  Scale,
  Unlock,
  Undo2,
  ScrollText,
  FileStack,
  Sparkles,
  Wallet,
} from "lucide-react";
import { SectionHeading } from "./SectionHeading";

const FEATURES = [
  {
    icon: Boxes,
    title: "Per-project bonded vault",
    body: "Every project gets its own vault contract, deployed by the factory from one published wasm hash you can reproduce from source. Contributions and the builder's performance bond live in that single contract — not in a platform account, and not pooled with anyone else's project.",
  },
  {
    icon: Scale,
    title: "Stakeholder-weighted milestone voting",
    body: "The stake you hold is the weight your vote carries. A tranche leaves the vault only when more than half of the total stake votes for it, inside a window fixed when the project was created.",
  },
  {
    icon: Unlock,
    title: "Permissionless release",
    body: "Once a vote carries, anyone at all can execute the release. There is no appointed signer to chase and nobody in a position to sit on funds the contributors have already approved.",
  },
  {
    icon: Undo2,
    title: "Refunds that need no cooperation",
    body: "Miss the goal by the deadline and every contribution comes back in full, with the bond returning to the builder. A failed milestone makes the remaining funds and the forfeited bond claimable pro-rata.",
  },
  {
    icon: ScrollText,
    title: "On-chain builder track record",
    body: "Closing a project writes builder, outcome, raise, bond, milestones approved and timestamp to an append-only attestation registry — so a builder's history follows them into their next raise.",
  },
  {
    icon: FileStack,
    title: "Decentralized document storage",
    body: "Blueprints, renders and listing media are pinned to IPFS through Pinata, so the material a funding decision was made on cannot be quietly swapped out later.",
  },
  {
    icon: Sparkles,
    title: "AI listing-quality analysis",
    body: "Genkit and Gemini 2.5 Flash read a draft listing before it goes live, flagging thin detail, missing documentation and claims a contributor would have no way to check.",
  },
  {
    icon: Wallet,
    title: "Wallet and session identity",
    body: "Email, password and Google sign-in through Supabase Auth, with Freighter for wallet linking and transaction signing. Authorization is enforced in the database by Row Level Security, not only in the app.",
  },
];

export function FeaturesSection() {
  return (
    <section
      id="features"
      className="relative scroll-mt-20 border-t bg-card py-20 sm:py-28"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Features"
          title="Everything the platform does, and nothing it can do to the vault"
          lead="The feature list and the security model are the same list read twice. Each capability below is built so that using it never requires trusting BLKFNDR with custody or with a decision."
        />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex h-full flex-col rounded-xl border bg-background p-6 transition-all hover:border-accent/50 hover:shadow-lg"
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
      </div>
    </section>
  );
}
