import Link from "next/link";
import { Eye, HandCoins, KeyRound } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { Button } from "@/components/ui/button";

/**
 * The three levels of participation, and what each one needs before anyone
 * invests the effort: nothing to read, an account and a wallet to stake, a
 * wallet of your own to steward.
 *
 * The Stake card carries the Phase 1 and 2 wording. The Phase 3 variant
 * ("approve with Face ID or fingerprint") goes in only once passkey wallets
 * ship; writing it earlier would promise something the product cannot do yet.
 */

const LEVELS = [
  {
    icon: Eye,
    title: "Watch",
    body: "No account needed. Read any vault's full money record and see every vote. Sign in to follow one.",
    cta: { label: "Browse projects", href: "/projects" },
  },
  {
    icon: HandCoins,
    title: "Stake",
    body: "Sign in with Google or email. Stake from $5 and approve in a wallet you control; we walk you through setup. In practice mode you add free practice money to your own wallet from your Wallet tab.",
    cta: { label: "See how staking works", href: "#how-it-works" },
  },
  {
    icon: KeyRound,
    title: "Steward",
    body: "Already run a wallet of your own? Set it up here, see every address and fee, and open vaults for your own projects.",
    cta: { label: "Set up your wallet", href: "/profile?tab=wallet" },
  },
];

export function TakePartSection() {
  return (
    <section
      id="take-part"
      className="relative scroll-mt-20 border-t bg-card py-20 sm:py-28"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Take part"
          title="Three ways to take part"
          lead="Pick the level that fits you. Each one says what it needs before you start."
        />

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {LEVELS.map(({ icon: Icon, title, body, cta }) => (
            <div
              key={title}
              className="flex h-full flex-col rounded-xl border bg-background p-6 transition-all hover:border-accent/50 hover:shadow-lg sm:p-8"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-headline text-xl font-semibold">
                {title}
              </h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
              <Button
                asChild
                variant="outline"
                className="mt-6 w-full border-foreground/20 sm:w-auto sm:self-start"
              >
                <Link href={cta.href}>{cta.label}</Link>
              </Button>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Whatever level you pick, your money is only ever held by the
          project&apos;s vault.
        </p>
      </div>
    </section>
  );
}
