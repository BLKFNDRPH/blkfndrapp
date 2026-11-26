import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { WalletPanel } from "@/components/settings/WalletSettings";
import { CampaignWalletCheck } from "@/components/campaign/CampaignWalletCheck";

export const metadata = {
  title: "Set up Freighter on Testnet — BLKFNDR",
  description:
    "Install Freighter, create or import a wallet, switch to Testnet, fund it with Friendbot, add a USDC trustline and link it to BLKFNDR.",
};

function Step({ id, n, title, children }: { id?: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <li id={id} className="scroll-mt-24 rounded-xl border border-border p-5">
      <h2 className="flex items-center gap-3 text-lg font-semibold tracking-tight">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </li>
  );
}

/**
 * The campaign's Freighter guide. Public reading; the last two steps act on
 * the signed-in account, through the same wallet panel and readiness card the
 * rest of the app uses.
 */
export default function FreighterGuidePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <Link href="/campaign" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the campaign
      </Link>

      <header className="mb-8">
        <h1 className="font-headline text-3xl font-bold tracking-tight">Set up Freighter on Testnet</h1>
        <p className="mt-3 text-muted-foreground">
          Freighter is a Stellar wallet that runs as a browser extension on a computer. It holds your
          keys on your device; BLKFNDR never sees them. Phones aren&apos;t supported yet, so use a
          desktop browser (Chrome, Brave, Edge or Firefox).
        </p>
      </header>

      <ol className="space-y-4">
        <Step n={1} title="Install Freighter">
          <p>
            Get it from{" "}
            <a href="https://freighter.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
              freighter.app
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            , which links to your browser&apos;s extension store. Only install it from there. Pin it to
            your toolbar so it&apos;s easy to find.
          </p>
        </Step>

        <Step n={2} title="Create or import a wallet">
          <p>
            Open Freighter and choose <strong>Create new wallet</strong>, or <strong>Import wallet</strong>{" "}
            if you already have a recovery phrase. Set a password for this browser.
          </p>
          <p>
            Write the 12-word recovery phrase on paper and keep it somewhere safe. It is the only way
            back into the wallet. Nobody from BLKFNDR will ever ask for it; anyone who does is trying
            to take your wallet.
          </p>
        </Step>

        <Step n={3} title="Switch Freighter to Testnet">
          <p>
            Freighter starts on Mainnet. Open it, press the network name at the top (it says
            &ldquo;Main Net&rdquo;) and pick <strong>Test Net</strong>. BLKFNDR&apos;s campaign runs on
            Testnet; a wallet on Mainnet won&apos;t connect.
          </p>
        </Step>

        <Step id="fund" n={4} title="Fund it with Friendbot">
          <p>
            A new Stellar account isn&apos;t on the ledger until it receives its first XLM. On Testnet,
            Friendbot, Stellar&apos;s faucet, sends free testnet XLM straight to your wallet. That
            activates the account and covers network fees. In Freighter, Testnet shows a{" "}
            <strong>Fund with Friendbot</strong> button; or use the button in step 7 once your wallet is
            linked.
          </p>
        </Step>

        <Step id="trustline" n={5} title="Add a USDC trustline">
          <p>
            A trustline lets your wallet hold USDC; nobody can send it to you without one. It reserves
            0.5 XLM of your own testnet XLM while it exists. The easiest way is the{" "}
            <strong>Add a USDC trustline</strong> button in step 7, which asks Freighter to add exactly the
            USDC BLKFNDR&apos;s vaults use, issuer included. You approve it in Freighter.
          </p>
        </Step>

        <Step id="link" n={6} title="Link the wallet to BLKFNDR">
          <p>
            Linking proves the wallet is yours: Freighter asks you to sign a one-time message. It moves
            no money. The practice USDC is only ever paid to this linked wallet.
          </p>
          <div className="pt-2">
            <WalletPanel purpose="for the Testnet campaign" doneHref="/campaign" doneLabel="Back to the campaign" />
          </div>
        </Step>

        <Step id="check" n={7} title="Check your wallet">
          <p>Once linked, this checks that your wallet is active on Testnet and can hold USDC, and fixes what&apos;s missing.</p>
          <div className="pt-2">
            <CampaignWalletCheck />
          </div>
        </Step>
      </ol>

      <p className="mt-8 text-sm text-muted-foreground">
        All set?{" "}
        <Link href="/campaign" className="font-medium text-primary underline-offset-4 hover:underline">
          Go back to the campaign
        </Link>{" "}
        to claim your practice USDC.
      </p>
    </main>
  );
}
