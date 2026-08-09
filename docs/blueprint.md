# **App Name**: blkfndr

## Core Features:

- Project Vault Creation: Let a builder create a project and deploy its own vault via the factory, integrated with Stellar/Soroban contracts and Pinata storage. The builder's performance bond and a flat platform fee are taken in the same transaction that creates the vault.
- Listing Moderation: Enable platform and project administrators to review, flag and clear listings through a dedicated console — off-chain, over Supabase with Row Level Security. Moderation never touches the vault.
- Live Project View: Display projects in a card-based view, pulling indexed on-chain and off-chain data to reflect real-time state (raising, funded, active, refunding, completed).
- Staking into a Vault: Let stakeholders back a project by contributing to its vault (from a $5 minimum). The stake is the voting weight it carries, capped at 20% per wallet, and stays the stakeholder's to reclaim.
- Stakeholder-Voted Releases: Milestone tranches leave the vault only when more than 50% of the total stake votes to release them; once carried, anyone can execute the release. There is no admin claim and no key that can withhold or redirect funds.
- Secure Authentication with Wallet + Session: Support Supabase Auth sessions (email/password, Google) plus Freighter wallet linking for staking and governance signatures.
- AI-Powered Listing Quality Tool: Use an AI-powered "listing quality tool" (Genkit + Gemini 2.5 Flash) that scans a draft listing to suggest improvements or flag issues before it goes live.

## Style Guidelines:

- Primary color: Dark blue (#003049) to convey trust and stability in financial transactions.
- Background color: Steel white (#F0F4F7), providing a clean and modern backdrop.
- Accent color: Red-orange (#D62828) to highlight key actions and calls to action, providing a sense of urgency and excitement.
- Body and headline font: 'Inter', a sans-serif, for a modern, machined look, suitable for headlines and body text.
- Code font: 'Source Code Pro' for displaying contract code and API keys.
- Use a set of consistent icons, with subtle use of the red-orange accent color to highlight key elements and actions.
- Design a card-based layout for project listings to enhance readability and user experience.