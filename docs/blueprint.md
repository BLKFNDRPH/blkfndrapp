# **App Name**: blkfndr

A secure, on-chain vault for real-world projects, on Stellar. Each project's money sits in its own contract, stakeholders vote on every release, and the record is public and permanent.

## Core Features:

- Project Vault Creation: A KYC-approved builder creates a project and deploys its own vault through the factory, with listing media on Pinata (IPFS). The builder's performance bond and the flat platform fee are taken in the same transaction that creates the vault. Before signing, the builder sees the simulated network fee and any bond blocker (no USDC trustline, low balance, unfunded wallet).
- Staking into a Vault: Stakeholders back a project by staking into its vault, from 5 units of the project's token (USDC or XLM). No fee is deducted. The stake is the voting weight it carries, capped at 20% of the raise per wallet, and stays the stakeholder's to reclaim in the paths where money comes back.
- Stakeholder-Voted Releases: The builder opens a 7-day vote per milestone. In the current contract source a tranche releases when approving weight exceeds 50% of the capped total (every stake after the 20% cap, summed), from at least three wallets, or every stakeholder when there are fewer than three. Vaults on testnet today still run the earlier rule (more than half of the raw raise). Once a vote carries, anyone can execute the release. There is no admin claim and no key that can withhold or redirect funds.
- Refunds and Forfeiture: A missed goal returns every stake and the bond. A lapsed milestone vote, or 90 days of builder inactivity, fails the project: stakeholders claim the remaining funds plus the forfeited bond. Closing a project writes a permanent record to the attestation registry.
- Per-Milestone Proof: The builder attaches proof to each milestone — a description of up to 4,000 characters and a photo (PNG, JPEG, WebP or GIF, up to 8 MB) — while the vault is funded or active and that milestone is neither released nor failed. Stakeholders see it in the project dialog before they vote.
- Live Project View: Projects appear as cards, built from indexed on-chain events and off-chain listing data, and reflect the vault's state (raising, funded, active, refunding, completed, failed).
- Listing Moderation: Off-chain, over Supabase with Row Level Security, and never touching a vault.
  - Hide and lock at the platform level. An Owner, Platform Administrator or Project Administrator can hide a project (off explore, search and the home page; its stakeholders still reach it) or lock it (the platform stops building new stakes and milestone-vote openings, and refuses milestone proof). Each needs a reason, is audit-logged and notifies the builder. A lock binds this interface, not the vault: refunds, votes in an open window and carried releases still work.
  - Owner review. A flagged listing stays hidden until two thirds of the owners vote to publish it. The console has no flag button yet.
- KYC Review: Reviewers approve identity in the console. The server signs the on-chain attestation with the reviewer's managed, gas-only wallet, so reviewers never handle a wallet and never touch project funds.
- Platform Governance: Owners govern the fee treasury and the Operations Vault from the console with their own wallets, by two-thirds vote: distributions, platform parameters, and the monthly gas budget for moderation.
- Secure Authentication with Wallet + Session: Supabase Auth sessions (email/password, Google) plus Freighter wallet linking. Every stake, vote and release is signed in the stakeholder's own wallet, and the signing wallet must match the account the action names.
- AI-Powered Listing Quality Tool: A listing quality review (Genkit + Gemini 2.5 Flash) scans a draft listing from the create form and suggests improvements or flags issues before it goes live.

## Style Guidelines:

- Palette: black, white and gold, defined as HSL tokens in `src/app/globals.css` with light and dark themes.
- Primary color: Near-black (`--primary: 0 0% 10%` in light, near-white `0 0% 96%` in dark), for buttons and emphasis.
- Background color: Warm off-white (`--background: 40 20% 98%`) in light; near-black (`0 0% 6%`) in dark.
- Accent color: Gold, at two lightnesses so it clears contrast both as text and as a fill (`--accent: 40 85% 31%` light, `44 85% 58%` dark). Used for headings and key actions.
- Destructive color: Red (`--destructive: 0 72% 45%` light), kept for errors so they read as errors, not as brand.
- Body and headline font: 'Inter', a sans-serif, for headlines and body text.
- Code font: 'Source Code Pro' for contract addresses, hashes and code.
- Wordmark font: 'Roboto Flex' (variable, self-hosted) for the blkfndr logo.
- Use a set of consistent icons, with subtle use of the gold accent to highlight key elements and actions.
- Design a card-based layout for project listings to enhance readability and user experience.
