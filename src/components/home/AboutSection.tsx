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
    title: "A project gets its own vault",
    body: "The vault is created on-chain with the builder's performance bond and a flat platform fee committed in the same transaction. There is no vault without a stake behind it.",
  },
  {
    step: "02",
    icon: HandCoins,
    title: "Stakeholders take a position",
    body: "Anyone backing the project joins its vault. The stake they hold is the weight their vote carries — and it stays theirs to reclaim.",
  },
  {
    step: "03",
    icon: Vote,
    title: "Every release is voted on-chain",
    body: "No tranche leaves the vault until the stakeholders vote it out, inside a window fixed when the project began. Once a vote carries, anyone can execute it — no appointed signer, no discretion.",
  },
  {
    step: "04",
    icon: FileCheck,
    title: "Every outcome goes on the record",
    body: "Closing the project appends the outcome — who built it, what was released and how it ended — to a registry with no update and no delete entrypoint.",
  },
];

const PARAMETERS = [
  { value: "$5", label: "Minimum stake" },
  { value: "Flat", label: "Platform fee, never a % of the vault" },
  { value: "5%", label: "Minimum performance bond" },
  { value: "7 days", label: "Release voting window" },
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
          title="A vault the platform can't open, and a record it can't rewrite"
          lead="BLKFNDR gives every real-world project its own vault on Stellar. The funds it safeguards, the milestones it tracks and every release it makes are recorded on-chain and governed by the project's own stakeholders. The platform holds no key that can move money or edit the record — so you verify what happened instead of trusting anyone to report it."
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
              Backing a real-world project means handing money to whoever holds
              it — a platform, a team, an escrow account — and trusting them to
              release it as promised and to report honestly on what happened. You
              rarely see the account. You can&apos;t audit the decisions. And
              when a project goes wrong, the record of it belongs to the party
              with the most reason to edit it.
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
              It replaces that trust with a contract. Every project runs on its
              own vault where the money, the milestones and every release are
              on-chain. The people with a stake in the project govern it, the
              platform holds no key that can move funds, and the full history is
              public and permanent — a shared record no one can quietly rewrite.
            </p>
          </div>
        </div>

        <div className="mt-16">
          <h3 className="text-center font-headline text-xl font-semibold sm:text-2xl">
            How a project&apos;s vault works
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
