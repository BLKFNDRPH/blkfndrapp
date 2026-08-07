"use client";

import StaticBLKFNDR from "./StaticBLKFNDR";

/**
 * The donation box that used to live here called `donate_to_platform` on the
 * retired crowdfunding contract. The bonded-vault contracts have no donation
 * entrypoint — money reaches the platform only as the flat per-project fee a
 * builder pays at creation, which is deliberate: it is the claim that the
 * platform never takes a share of what contributors put in.
 *
 * Reinstating donations means adding an entrypoint and deciding where the funds
 * land, which is a product decision rather than part of this migration.
 */
export default function Footer() {
  return (
    <footer className="py-6 md:px-8 md:py-0 border-t">
      <div className="container flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
        <div className="text-balance text-center text-sm leading-loose text-muted-foreground md:text-left">
          © {new Date().getFullYear()}{" "}
          <StaticBLKFNDR className="-mt-2 inline-block text-lg font-bold align-middle" />
          . All rights reserved.
        </div>

        <p className="text-center text-sm text-muted-foreground md:text-right">
          Contributions are held by the contract, never by blkfndr.
        </p>
      </div>
    </footer>
  );
}
