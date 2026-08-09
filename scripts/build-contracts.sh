#!/usr/bin/env bash
#
# Compile every Soroban contract to wasm.
#
# Run this before `cargo test`: the factory's deployment tests need
# blkfndr_vault.wasm to exist, and skip themselves when it does not.
#
# The build hash printed at the end is what a reviewer checks the deployed
# contract against.

set -euo pipefail

cd "$(dirname "$0")/.."

CONTRACTS=(
  blkfndr-vault
  blkfndr-factory
  blkfndr-attestation
  blkfndr-identity
  blkfndr-admin
  blkfndr-treasury
  blkfndr-operations
)

if ! rustup target list --installed | grep -q wasm32-unknown-unknown; then
  echo "Installing wasm32-unknown-unknown target..."
  rustup target add wasm32-unknown-unknown
fi

for contract in "${CONTRACTS[@]}"; do
  echo "Building ${contract}..."
  cargo build --release --target wasm32-unknown-unknown -p "${contract}"
done

OUT=target/wasm32-unknown-unknown/release

echo
echo "Build artifacts and hashes"
echo "──────────────────────────"
for contract in "${CONTRACTS[@]}"; do
  wasm="${OUT}/${contract//-/_}.wasm"
  if [ -f "${wasm}" ]; then
    size=$(wc -c < "${wasm}" | tr -d ' ')
    hash=$(sha256sum "${wasm}" | cut -d' ' -f1)
    printf '%-22s %8s bytes  sha256:%s\n' "${contract}" "${size}" "${hash}"
  fi
done
