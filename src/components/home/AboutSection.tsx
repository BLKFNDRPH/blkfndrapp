import { Building2, HandCoins, Vote, FileCheck } from "lucide-react";
import { SectionHeading } from "./SectionHeading";

/**
 * "How a vault works": the four steps and the four platform rules, in the words
 * the rest of the product uses (vault, stake, stage, payout, builder's deposit).
 *
 * The rule values are the ones the contracts were deployed with. They are not
 * read live: the platform-info call the app already makes does not return them,
 * and this increment adds no new reads. Change them here when the contracts
 * change.
 */

const STEPS = [
  {
    step: "1",
    icon: Building2,
    title: "A project gets its own vault.",
    body: "The builder locks a deposit inside it first.",
  },
  {
    step: "2",
    icon: HandCoins,
    title: "People stake.",
    body: "From $5. Every stake is recorded publicly.",
  },
  {
    step: "3",
    icon: Vote,
    title: "Stakeholders vote on each payout.",
    body: "More than half of all stakes must say yes; no one person counts for more than 20%.",
  },
  {
    step: "4",
    icon: FileCheck,
    title: "Every outcome goes on the record.",
    body: "Delivered stages pay the builder; failed stages return money and the deposit to stakeholders.",
  },
];

const RULES = [
  { value: "$5", label: "minimum stake" },
  {
    value: "Flat",
    label: "listing fee paid by the builder, never a cut of your stake",
  },
  { value: "5%", label: "builder's deposit, minimum" },
  { value: "7-day", label: "vote on every payout" },
];

export function AboutSection() {
  return (
    <section
      id="how-it-works"
      className="relative scroll-mt-20 border-t bg-background py-20 sm:py-28"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="How it works"
          title="How a vault works"
          lead="Four steps, the same for every project. The money never passes through BLKFNDR at any of them."
        />

        <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ step, icon: Icon, title, body }) => (
            <li
              key={step}
              className="group relative flex h-full flex-col rounded-xl border bg-card p-6 transition-colors hover:border-accent/50"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-accent/40 font-headline text-sm font-bold text-accent"
                  aria-hidden="true"
                >
                  {step}
                </span>
              </div>
              <h3 className="mt-4 font-headline text-base font-semibold">
                <span className="sr-only">Step {step}: </span>
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </li>
          ))}
        </ol>

        <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
          {RULES.map(({ value, label }) => (
            <div key={label} className="bg-card px-5 py-6 text-center">
              <dt className="sr-only">{label}</dt>
              <dd className="font-headline text-2xl font-bold text-accent sm:text-3xl">
                {value}
              </dd>
              <dd className="mt-1 text-xs leading-snug text-muted-foreground">
                {label}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Platform rules as currently set on the practice network.
        </p>
      </div>
    </section>
  );
}
