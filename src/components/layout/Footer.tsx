"use client";

import StaticBLKFNDR from "./StaticBLKFNDR";

/**
 * The donation box that used to live here called `donate_to_platform` on the
 * retired contract. The vault contracts have no donation entrypoint — money
 * reaches the platform only as the flat listing fee a builder pays at creation,
 * which is deliberate: it is the claim that the platform never takes a share of
 * what stakeholders put in.
 *
 * Reinstating donations means adding an entrypoint and deciding where the funds
 * land, which is a product decision rather than part of this migration.
 *
 * "Secured on the Stellar network" is the one place outside the auditors'
 * disclosure where the network is named: a single trust line, not a value prop.
 */
export default function Footer() {
  return (
    <footer className="border-t py-6 md:px-8 md:py-0">
      <div className="container flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
        <div className="text-balance text-center text-sm leading-loose text-muted-foreground md:text-left">
          © {new Date().getFullYear()}{" "}
          <StaticBLKFNDR className="-mt-2 inline-block align-middle text-lg font-bold" />
        </div>

        <div className="flex flex-col items-center gap-1 text-center text-sm text-muted-foreground md:items-end md:text-right">
          <p>
            Stakes are held in each project&apos;s vault, never in a BLKFNDR
            account.
          </p>
          <p className="text-xs text-muted-foreground/80">
            Secured on the Stellar network
          </p>
        </div>
      </div>
    </footer>
  );
}
