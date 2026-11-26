import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RefCapture } from "@/components/campaign/RefCapture";
import { CampaignPanel } from "@/components/campaign/CampaignPanel";

export const metadata = {
  title: "Testnet campaign — BLKFNDR",
  description:
    "Practise staking on BLKFNDR with testnet money: set up a Stellar wallet, claim practice USDC and stake in a real vault on Testnet. Nothing real moves.",
};

const STEPS = [
  {
    title: "Create an account",
    body: "An email address or a Google account. No wallet needed yet.",
  },
  {
    title: "Set up Freighter on Testnet",
    body: "Install the Freighter wallet, switch it to Testnet, fund it with free testnet XLM from Friendbot and add a USDC trustline. The guide walks you through each step.",
  },
  {
    title: "Link your wallet and claim practice USDC",
    body: "Link the wallet to your BLKFNDR account, then claim testnet USDC. It is paid straight into your own wallet, once per account.",
  },
  {
    title: "Stake in a real vault",
    body: "Pick a project and stake. The vault is a real Soroban contract on Stellar Testnet: stakeholders vote on every payout, and BLKFNDR can't open it.",
  },
];

/**
 * The campaign landing page. Public. A visitor arriving on a referral link
 * (`?ref=CODE`) has the code kept for sign-up by RefCapture.
 */
export default function CampaignPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <RefCapture />

      <header className="mb-10">
        <p className="mb-3 inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-foreground/90">
          Testnet campaign · practice money only
        </p>
        <h1 className="font-headline text-3xl font-bold tracking-tight sm:text-4xl">
          Try BLKFNDR end to end, with money that isn&apos;t real
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
          Get a Stellar wallet set up, claim practice USDC, and stake in a real project vault on
          Stellar Testnet. It&apos;s the same contracts and the same steps as the real thing, but
          everything here is testnet money: it&apos;s free, it can&apos;t be cashed out, and nothing
          real moves.
        </p>
      </header>

      <section aria-labelledby="campaign-steps" className="mb-10">
        <h2 id="campaign-steps" className="mb-4 text-xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="space-y-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4 rounded-xl border border-border p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {i + 1}
              </span>
              <div>
                <p className="font-medium text-foreground">{step.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/campaign/freighter">
            Open the Freighter guide
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </section>

      <section aria-labelledby="campaign-you" className="mb-10">
        <h2 id="campaign-you" className="mb-4 text-xl font-semibold tracking-tight">
          Your part
        </h2>
        <CampaignPanel />
      </section>

      <section aria-labelledby="campaign-honest" className="rounded-xl border border-border bg-muted/20 p-5 text-sm text-muted-foreground">
        <h2 id="campaign-honest" className="mb-2 text-base font-semibold text-foreground">
          What to know
        </h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Testnet USDC and testnet XLM have no value. You can&apos;t buy them or cash them out.</li>
          <li>Your wallet&apos;s keys stay on your device. BLKFNDR never holds them and can&apos;t move what&apos;s in your wallet.</li>
          <li>The practice USDC only ever goes to the wallet linked to your account, never to an address typed in.</li>
          <li>Testnet is reset by Stellar from time to time; balances there can disappear when it is.</li>
        </ul>
      </section>
    </main>
  );
}
