# Contract Bindings

The app talks to the seven Soroban contracts through TypeScript bindings generated from their wasm. They live in [src/packages/](../src/packages/), one folder per contract:

| Folder | Contract |
|---|---|
| `blkfndr_vault` | Per-project vault |
| `blkfndr_factory` | Vault factory |
| `blkfndr_attestation` | Builder completion record |
| `blkfndr_identity` | KYC attestation registry |
| `blkfndr_admin` | Platform admin roster |
| `blkfndr_treasury` | Fee treasury and owner governance |
| `blkfndr_operations` | Operations Vault |

## No install step

The bindings are consumed as **source**, through the `@/` path alias (`import { Client } from "@/packages/blkfndr_vault/src"`). They are not npm packages and there is nothing to `npm install` or build inside them.

They deliberately have no `package.json`. Installing inside a binding folder creates a second copy of `@stellar/stellar-sdk`, whose types then differ from the app's — an `AssembledTransaction` from the binding stops being assignable to the app's.

Most code does not import a binding directly. [src/lib/stellar-clients.ts](../src/lib/stellar-clients.ts) builds a configured client per contract (`vaultClient`, `factoryClient`, `operationsClient`, …) from the contract IDs in the environment, and [src/lib/freighter-signer.ts](../src/lib/freighter-signer.ts) supplies the signer for anything that needs a signature.

## Regenerating after a contract change

```bash
bash scripts/build-contracts.sh
stellar contract bindings typescript \
  --wasm target/wasm32-unknown-unknown/release/blkfndr_vault.wasm \
  --output-dir src/packages/blkfndr_vault --overwrite
rm src/packages/blkfndr_vault/{package.json,tsconfig.json,README.md}
```

Repeat for each contract that changed. The generator wraps `src/index.ts` in an npm package; delete its `package.json`, `tsconfig.json` and `README.md` afterwards, for the reason above. See [src/packages/README.md](../src/packages/README.md).

A binding decodes contract structs **by field position**. A new field on a `#[contracttype]` struct must sort last, and the app must ship with the new binding before any deployed contract starts returning the new shape — an old binding crashes on it. Vault changes so far (#99) kept `Milestone` and `ProjectInfo` byte-identical, so old and new bindings decode both old and new vaults.
