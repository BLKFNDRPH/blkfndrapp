# Documentation Coverage

## Objective

Track which documentation pages cover which parts of the platform, and when each was last checked against the code. The repository is the single source of truth; see [gitbook-sync.md](gitbook-sync.md) for how GitBook mirrors it.

## Coverage Matrix

Last full review: **2026-10-02 to 2026-10-03**, against `main` at #104. Every page below was re-checked against the source in that pass.

| Area | Page | Status | Notes |
|---|---|---|---|
| Overview, setup, environment | [README.md](../README.md) | Current | Status table, testnet addresses, release rule, quick start, env vars |
| Live status and open work | [progress.md](../progress.md) | Current | Live vs shelf-ready, pending owner actions, known defects |
| Product and economic model | [whitepaper.md](whitepaper.md) | Current | Vault positioning, flat builder-paid fee, bond, release rule, treasury governance |
| System design and data flow | [architecture.md](architecture.md) | Current | Indexer, crons, RLS, moderation, launch and proof flows |
| Contract API | [smart-contracts.md](smart-contracts.md) | Current | All seven contracts, release rule, deployed addresses |
| Contract bindings | [blkfndr-stellar-cntrct-setup.md](blkfndr-stellar-cntrct-setup.md) | Current | Generated TypeScript bindings and how to regenerate them |
| HTTP routes and server actions | [api-reference.md](api-reference.md) | Current | Every `src/app/api` route and exported action |
| Auth, sessions, wallet linking | [authentication.md](authentication.md) | Current | Supabase Auth, Google, Freighter linking and signing, admin roster |
| AI listing review | [ai-features.md](ai-features.md) | Current | Implemented Genkit flow; query analysis and sentiment tracking are design specs only |
| Deployment and operations | [deployment.md](deployment.md) | Current | Docker, Portainer, compose crons, env vars, contract deploys |
| Contributing | [contributing.md](contributing.md) | Current | Setup, checks, migrations, PR conventions |
| Product blueprint | [blueprint.md](blueprint.md) | Current | Core features and style guide |
| Web3 accessibility redesign | [design/web3-accessibility-redesign.md](design/web3-accessibility-redesign.md) | Brief | Design input, not a description of shipped behaviour |
| Storage migration | [migration-tusky-pinata.md](migration-tusky-pinata.md) | Historical | Completed migration, kept for reference |

## Feature Coverage Checklist

- [x] Project vault lifecycle (raising → funded → active → refunding / completed)
- [x] Stakeholder-weighted milestone release (capped total, three-wallet floor)
- [x] Flat builder-paid fee and performance bond
- [x] Treasury and Operations Vault governance
- [x] Platform moderation: approval consensus, hide and lock
- [x] KYC attestation and managed attestor keys
- [x] Event indexer, keeper and keep-alive crons
- [x] HTTP routes and server actions
- [x] AI listing review
- [ ] AI query analysis — specified, not implemented
- [ ] AI sentiment tracking — specified, not implemented

## Change Control

A PR that changes behaviour updates, in the same PR:

- `README.md` when setup, environment or the status table changes
- `docs/<area>.md` when that area's behaviour changes
- `progress.md` when something becomes live, pending or open
- `docs/SUMMARY.md` when a page is added, removed or renamed
- this page's matrix when coverage changes
