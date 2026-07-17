# Content Migration

## Objective

Track and verify migration of blkfndr documentation into a complete GitHub + GitBook documentation system.

## Scope

- Root onboarding and technical README
- Detailed docs in `docs/`
- GitBook sync and sidebar structure
- Feature-level documentation for platform and AI capabilities

## Migration Matrix

| Area | Source | Target | Status | Notes |
|---|---|---|---|---|
| Project overview and setup | Legacy README | `README.md` | Complete | Includes installation, configuration, and API usage examples |
| Whitepaper | Parent workspace file | `docs/whitepaper.md` | Complete | Core protocol thesis and strategic roadmap |
| Architecture | Internal project notes | `docs/architecture.md` | Complete | System diagrams and data flows included |
| Smart contracts | Internal specs | `docs/smart-contracts.md` | Complete | Contract models, methods, and operational notes |
| API reference | Internal snippets | `docs/api-reference.md` | Complete | Soroban RPC, Horizon, Server Actions, REST |
| Authentication | Legacy auth notes | `docs/authentication.md` | Complete | Freighter and NextAuth flows |
| Deployment | Team runbooks | `docs/deployment.md` | Complete | Docker and Portainer guides |
| Storage migration | Tusky migration notes | `docs/migration-tusky-pinata.md` | Complete | Migration details preserved |
| GitBook integration | Ticket requirement | `docs/gitbook-sync.md` | Complete | Bi-directional sync checklist |
| AI listing quality analysis | Existing implementation | `docs/ai-features.md` | Complete | Includes flow design, schema, and example |
| AI query analysis | Ticket requirement | `docs/ai-features.md` | Complete (Spec) | Documented design and integration snippets |
| AI sentiment tracking | Ticket requirement | `docs/ai-features.md` | Complete (Spec) | Documented pipeline and dashboard metrics |

## Feature Coverage Checklist

- [x] Project listing lifecycle
- [x] Multi-sig admin workflow
- [x] Funding and fee behavior
- [x] API and server action usage
- [x] Listing quality AI
- [x] Query analysis AI
- [x] Sentiment tracking AI
- [x] Visual diagrams for architecture and AI pipelines

## Migration Process

1. Audit existing docs and source code for feature parity.
2. Normalize blockchain assumptions and terminology (Stellar/Soroban).
3. Add missing pages and link them via `docs/SUMMARY.md`.
4. Add code snippets and diagrams for all requested feature docs.
5. Verify GitBook sync behavior from GitHub and back.

## Change Control

Any PR that changes behavior for listed features must also update:

- `README.md` if setup/API usage changes
- `docs/<feature>.md` if technical behavior changes
- `docs/content-migration.md` status rows when coverage expands or regresses
