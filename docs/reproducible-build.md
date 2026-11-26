# Reproducible contract build

Anyone can rebuild the Soroban contracts from source and get the same wasm,
byte for byte, as CI. That is what lets a reviewer check that the code on chain
is the code in this repository.

The build runs in a container pinned by digest (`Dockerfile.contracts`):
`rust:1.81.0-slim-bookworm@sha256:f9fb6bdb…3197`, run as `linux/amd64` on every
host. `scripts/reproducible-build.sh` mounts the repository read-only, copies
the contract sources to the fixed path `/build` with LF line endings, and runs
`scripts/build-contracts.sh` there: the same per-contract `cargo build --locked
--release --target wasm32-unknown-unknown` the host runs, with the workspace's
`[profile.release]`. `CARGO_HOME` and `/build` are remapped
(`--remap-path-prefix`) and `SOURCE_DATE_EPOCH` is the commit time. There is no
`stellar contract optimize` step, because the deployed wasm is the plain cargo
output.

CI (`.github/workflows/ci.yml`) and `npm run ci:local` record and upload the
hashes from this container build. The host build is still there, but only to
feed clippy and the tests.

## Why not the host build

A host build writes the absolute path of the cargo registry into the wasm, in
the panic location strings of `soroban-sdk`. On Windows that is
`C:\Users\<you>\.cargo\registry\src\…` with backslashes, so the hash depends on
the operating system, the user name and where `CARGO_HOME` is. Paths inside
the repository are relative, so the checkout's own location does not matter.

The vault deployed on testnet today (`e9009410…2d95`) was built that way, on a
Windows host as user `admin`. Rebuilding the current source on such a host
gives exactly `e9009410…`. The container build gives a different hash (see the
table below) because its embedded paths are `/cargo/registry/src/…`. To make
the deployed vault reproducible on any machine, the next deploy should upload
the container build's `wasm/blkfndr_vault.wasm` rather than the host build.

## Reproduce on a second machine

You need git, bash (Git Bash on Windows) and Docker running. Nothing else: Rust
comes from the image.

```bash
git clone https://github.com/BLKFNDRPH/blkfndrapp.git
cd blkfndrapp
git checkout <commit CI built>
bash scripts/reproducible-build.sh
```

The first run downloads the base image and the crates (a few minutes). Results
go to `target/reproducible/`:

- `wasm-hashes.txt`: `sha256  contract.wasm`, one line per contract, sorted
- `build-info.txt`: commit, whether there were uncommitted edits, base image,
  platform, host and the exact rustc and cargo versions
- `wasm/*.wasm`: the contracts

Build a clean checkout of a commit. If `build-info.txt` says
`uncommitted edits: yes`, the hashes are not comparable with anyone else's.

## Compare

Get the other side's `wasm-hashes.txt`: from CI, it is in the
`soroban-contracts` artifact; from `npm run ci:local`, it is
`ci-local/wasm-hashes.txt`; from another machine, it is the file above. Then:

```bash
bash scripts/reproducible-build.sh --compare path/to/their-wasm-hashes.txt
```

builds and compares, or, if you have already built:

```bash
bash scripts/reproducible-build.sh --compare path/to/their-wasm-hashes.txt --no-build
```

It prints `MATCH` and exits 0 when every contract hash is identical, and
otherwise prints the differing lines and exits 1. Comment lines, blank lines
and CRLF line endings in either file are ignored.

## Check the chain

The factory instantiates every project vault from one wasm hash. Read it
either from the app (`GET /api/vault-wasm-hash`, the hash the homepage shows,
read live from the factory) or from `BLKFNDR_VAULT_WASM_HASH` in
`deployments/<network>/contracts.env`. Then fetch that wasm from the chain and
hash it, and compare with your build:

```bash
stellar contract fetch --network testnet \
  --wasm-hash e9009410b9cbb4c5bfb7cca747812dcad6a044d09c648a1e392a84fe7e182d95 \
  -o vault-onchain.wasm
sha256sum vault-onchain.wasm target/reproducible/wasm/blkfndr_vault.wasm
```

For a contract instance (the factory, a particular project's vault), fetch by
its id instead: `stellar contract fetch --network testnet --id C… -o x.wasm`.
The hash of the fetched bytes is the on-chain code hash, so it must equal the
line for that contract in `wasm-hashes.txt`. (Today it does not, for the
reason above: the deployed vault is a host build.)

## Results

Hashes of the same commit from different machines. A row per machine; the
build is reproducible when every row agrees.

Commit `d42f5ac` (the contract sources are unchanged from main at `19cd635`,
so a build of either gives these hashes). Base image
`rust:1.81.0-slim-bookworm@sha256:f9fb6bdb0483de4ade93b262a3f6cf8c2985fca1d34784914bbcabd5a34d3197`,
platform `linux/amd64`, rustc 1.81.0 (eeb90cda1 2024-09-04), cargo 1.81.0.

| Contract | Machine 1: Windows 11 (Docker Desktop, WSL2), 2026-11-27 | Machine 2: _to fill_ |
|---|---|---|
| `blkfndr_admin.wasm` | `09093d63a24d6dde373a8a0e2e8559399364653ef74c0d4a7b82e0576b598a74` | |
| `blkfndr_attestation.wasm` | `696c184c7d2efebb6ec9ae22a259b052a555ce290c05405c276f5094c86ea5d1` | |
| `blkfndr_factory.wasm` | `75c35433296eea090f6bb59faa3c73425c0eeb614e8334125426d6326fb3919c` | |
| `blkfndr_identity.wasm` | `3a57c1c98517ff11c16466e29e07a6b7e0278556c7dc9c2e749ffca5c8c55d25` | |
| `blkfndr_operations.wasm` | `795219e82c169bf0d209abe24e210c0bb2605a3c7178e9410f9325fbf5cbcd13` | |
| `blkfndr_report_anchor.wasm` | `2c1947668c448196147ae5bc294016a2c66598ab52090012064d809604d766ca` | |
| `blkfndr_treasury.wasm` | `a07bc16f6aaa7a6c8b35da4213b05d39c1577d5eda2bf5a7acbf1792aa0b96ab` | |
| `blkfndr_vault.wasm` | `279f6d777ee69c6031fd0e28abae27fec3f430108e2dc9e3ce7499f9e650f726` | |

Machine 1 built it three times (twice standalone, once through
`npm run ci:local`) with identical hashes each time.

For comparison, the host build on machine 1 (`scripts/build-contracts.sh`,
Windows, `x86_64-pc-windows-gnu` rustc 1.81.0) gives different hashes for
every contract, as expected. Its vault hash is the deployed one:

| Contract | Host build, machine 1 |
|---|---|
| `blkfndr_admin.wasm` | `00ebfb91b89271e2ae82a5665989d18a4847a2d65846a957147bc2738a6879b3` |
| `blkfndr_attestation.wasm` | `66f73252a5b92502ae91ca95f566abff1b042c7537316de44693392e8ef78213` |
| `blkfndr_factory.wasm` | `eb20ce0fb7caf8fc1079c35f64cc0f972722c217f37a223c2c0d1195d19cab77` |
| `blkfndr_identity.wasm` | `a0574873936f7a8d2a2954dfb2e57c55cdf48e86d5c781725a9f6bc7c625d8d3` |
| `blkfndr_operations.wasm` | `08360ea4a01185cdd9ef9e24666b29e949687ac6f66be954cf0de335ba9690c1` |
| `blkfndr_report_anchor.wasm` | `c4ff0e4bdddbb2cd6a468f7bfe2b5ba87dc615b050b22034f9fc742d552c6d0d` |
| `blkfndr_treasury.wasm` | `3dc2b67d010c690ff188757a65aba47dee080aa4819e2d3df8c05504c3718886` |
| `blkfndr_vault.wasm` | `e9009410b9cbb4c5bfb7cca747812dcad6a044d09c648a1e392a84fe7e182d95` (on testnet) |

## Changing the toolchain

`rust-toolchain.toml`, the `toolchain:` in `ci.yml` and the `FROM` line of
`Dockerfile.contracts` move together. Refresh the digest with:

```bash
docker pull rust:<version>-slim-bookworm
docker inspect --format '{{index .RepoDigests 0}}' rust:<version>-slim-bookworm
```

Every hash changes with it, so record a new results table.
