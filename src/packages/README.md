# Generated contract bindings

Produced by `stellar contract bindings typescript` from the wasm that was
deployed, and consumed as **source** through the `@/packages/*` alias — not as
npm packages.

They deliberately have no `package.json`. Installing inside one creates a second
copy of `@stellar/stellar-sdk`, which gives its types a different identity from
the app's and makes `AssembledTransaction` from a binding incompatible with
`AssembledTransaction` in the app.

Regenerate after any contract change:

```bash
bash scripts/build-contracts.sh
stellar contract bindings typescript \
  --wasm target/wasm32-unknown-unknown/release/blkfndr_vault.wasm \
  --output-dir src/packages/blkfndr_vault --overwrite
```
