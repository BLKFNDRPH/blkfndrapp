import {
  Building2,
  Globe2,
  HandCoins,
  Landmark,
  Vote,
  FileCheck,
} from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import StaticBLKFNDR from "@/components/layout/StaticBLKFNDR";

const LIFECYCLE = [
  {
    step: "01",
    icon: Building2,
    title: "A builder creates a project",
    body: "The performance bond and a flat platform fee are taken in the same transaction that creates the vault. There is no path to a vault without a bond behind it.",
  },
  {
    step: "02",
    icon: HandCoins,
    title: "Contributors back it",
    body: "From $5 USDC upward. The amount contributed is also the voting weight it carries, and no fee is deducted from a contribution.",
  },
  {
    step: "03",
    icon: Vote,
    title: "Contributors vote each milestone out",
    body: "The builder opens a milestone vote. Release needs a contributor majority — and once the vote carries, anyone can execute it.",
  },
  {
    step: "04",
    icon: FileCheck,
    title: "Close writes a permanent record",
    body: "Builder, project, outcome, raise, bond, milestones approved and timestamp go to an append-only registry that has no update or delete entrypoint.",
  },
];

const PARAMETERS = [
  { value: "$5", label: "Minimum contribution" },
  { value: "Flat", label: "Platform fee, never a % of the raise" },
  { value: "5%", label: "Minimum performance bond" },
  { value: "7 days", label: "Milestone voting window" },
];

export function AboutSection() {
  return (
    <section
      id="about"
      className="relative scroll-mt-20 border-t bg-background py-20 sm:py-28"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="About"
          title="Real-world buildings, funded by the people who want them built"
          lead="blkfndr is a crowdfunding platform on Stellar where the builder is economically accountable on-chain. Contributions pool into a per-project vault, the builder's performance bond is locked in the same contract, and milestone tranches are released only when contributors themselves vote to release them."
        />

        <div className="mx-auto mt-14 grid max-w-5xl gap-8 md:grid-cols-2">
          <div className="rounded-xl border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Landmark className="h-5 w-5" />
              </span>
              <h3 className="font-headline text-lg font-semibold">
                The problem
              </h3>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Local developers — particularly across the Philippines and
              Southeast Asia — meet red tape, high interest rates and local
              liquidity bottlenecks the moment they approach a traditional bank.
              At the same time, ordinary people are priced out of the asset class
              entirely, because participating at all has historically demanded
              capital most of them will never have in one place.
            </p>
          </div>

          <div className="rounded-xl border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Globe2 className="h-5 w-5" />
              </span>
              <h3 className="font-headline text-lg font-semibold">
                What <StaticBLKFNDR className="-mt-1 inline-block align-middle text-lg" /> does
              </h3>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              It connects those builders directly to global on-chain liquidity,
              from the blueprint stage, and it does so without asking anyone to
              trust the platform. Money sits in a contract rather than an
              account, the builder has their own capital at risk in that same
              contract, and the people who funded the project are the ones who
              decide when the next tranche is earned.
            </p>
          </div>
        </div>

        <div className="mt-16">
          <h3 className="text-center font-headline text-xl font-semibold sm:text-2xl">
            How funding works
          </h3>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {LIFECYCLE.map(({ step, icon: Icon, title, body }) => (
              <div
                key={step}
                className="group relative flex h-full flex-col rounded-xl border bg-card p-6 transition-colors hover:border-accent/50"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="font-code text-xs font-bold tracking-widest text-muted-foreground/60">
                    {step}
                  </span>
                </div>
                <h4 className="mt-4 font-headline text-base font-semibold">
                  {title}
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
          {PARAMETERS.map(({ value, label }) => (
            <div key={label} className="bg-card px-5 py-6 text-center">
              <div className="font-headline text-2xl font-bold text-accent sm:text-3xl">
                {value}
              </div>
              <div className="mt-1 text-xs leading-snug text-muted-foreground">
                {label}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Platform parameters as currently deployed to Stellar testnet.
        </p>
      </div>
    </section>
  );
}
