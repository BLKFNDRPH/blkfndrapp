#!/usr/bin/env bash
#
# Deploy and initialize the BLKFNDR contract set.
#
# Initialization order is not obvious and getting it wrong is not recoverable
# for a given deployment, because every initialize is once-only:
#
#   * the attestation registry must be bound to the factory's address, and
#   * the factory must be configured with the attestation registry's address.
#
# Neither can be initialized before the other exists, so all four contracts are
# deployed first and initialized afterwards. Deployment and initialization are
# separate operations, which is what makes the cycle resolvable at all.
#
# The vault is not deployed here. It is uploaded as wasm and the factory
# instantiates one per project from that hash.
#
# Usage:
#   scripts/deploy-contracts.sh --network testnet --source my-key
#
# Requires the Stellar CLI and a funded, configured source account.

set -euo pipefail

cd "$(dirname "$0")/.."

NETWORK="testnet"
SOURCE=""
FEE_WALLET=""
PLATFORM_FEE="100000000"      # 10 units at 7 decimals
MIN_CONTRIBUTION="50000000"   # 5 units — the SOW entry point
VOTING_WINDOW="604800"        # 7 days in seconds
OUT_FILE="deployed-contracts.env"

usage() {
  cat <<USAGE
Deploy the BLKFNDR contract set.

  --network <name>          Stellar network (default: testnet)
  --source <account>        Stellar CLI identity to deploy from (required)
  --fee-wallet <address>    Destination for platform fees (default: source address)
  --platform-fee <stroops>  Flat per-project fee (default: ${PLATFORM_FEE})
  --min-contribution <n>    Minimum contribution in stroops (default: ${MIN_CONTRIBUTION})
  --voting-window <secs>    Milestone voting window (default: ${VOTING_WINDOW})
  --out <file>              Where to write the resulting IDs (default: ${OUT_FILE})
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)          NETWORK="$2"; shift 2 ;;
    --source)           SOURCE="$2"; shift 2 ;;
    --fee-wallet)       FEE_WALLET="$2"; shift 2 ;;
    --platform-fee)     PLATFORM_FEE="$2"; shift 2 ;;
    --min-contribution) MIN_CONTRIBUTION="$2"; shift 2 ;;
    --voting-window)    VOTING_WINDOW="$2"; shift 2 ;;
    --out)              OUT_FILE="$2"; shift 2 ;;
    -h|--help)          usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "${SOURCE}" ]]; then
  echo "error: --source is required" >&2
  usage
  exit 1
fi

if ! command -v stellar >/dev/null 2>&1; then
  echo "error: the Stellar CLI is not on PATH." >&2
  echo "       cargo install --locked stellar-cli" >&2
  exit 1
fi

ADMIN=$(stellar keys address "${SOURCE}")
FEE_WALLET="${FEE_WALLET:-$ADMIN}"

echo "network      ${NETWORK}"
echo "admin        ${ADMIN}"
echo "fee wallet   ${FEE_WALLET}"
echo "platform fee ${PLATFORM_FEE} stroops (flat, per project, paid by the builder)"
echo

# ── Build ──────────────────────────────────────────────────────────────────

echo "Building contracts..."
bash scripts/build-contracts.sh >/dev/null
OUT=target/wasm32-unknown-unknown/release
echo "  done"
echo

deploy() {
  stellar contract deploy \
    --wasm "${OUT}/$1.wasm" \
    --source "${SOURCE}" \
    --network "${NETWORK}" 2>/dev/null | tail -1
}

invoke() {
  local id="$1"; shift
  stellar contract invoke \
    --id "${id}" \
    --source "${SOURCE}" \
    --network "${NETWORK}" \
    -- "$@" >/dev/null
}

# ── Upload the vault wasm ──────────────────────────────────────────────────
#
# Uploaded, not deployed: the factory instantiates a vault per project from
# this hash.

echo "Uploading vault wasm..."
VAULT_WASM_HASH=$(stellar contract upload \
  --wasm "${OUT}/blkfndr_vault.wasm" \
  --source "${SOURCE}" \
  --network "${NETWORK}" 2>/dev/null | tail -1)
echo "  hash ${VAULT_WASM_HASH}"

# ── Deploy, all before any initialize ──────────────────────────────────────

echo
echo "Deploying contracts..."
IDENTITY_ID=$(deploy blkfndr_identity);     echo "  identity    ${IDENTITY_ID}"
ADMIN_ID=$(deploy blkfndr_admin);           echo "  admin       ${ADMIN_ID}"
FACTORY_ID=$(deploy blkfndr_factory);       echo "  factory     ${FACTORY_ID}"
ATTESTATION_ID=$(deploy blkfndr_attestation); echo "  attestation ${ATTESTATION_ID}"

# ── Initialize ─────────────────────────────────────────────────────────────
#
# The attestation registry is bound to the factory, and the factory is told
# where the attestation registry lives. Both addresses exist by now, so the
# order within this block does not matter — only that it comes after every
# deploy.

echo
echo "Initializing..."

invoke "${IDENTITY_ID}" initialize --admin "${ADMIN}"
echo "  identity registry bound to admin"

invoke "${ADMIN_ID}" initialize --owner "${ADMIN}"
echo "  admin roster bound to owner"

invoke "${ATTESTATION_ID}" initialize --admin "${ADMIN}" --factory "${FACTORY_ID}"
echo "  attestation registry bound to factory"

invoke "${FACTORY_ID}" initialize \
  --admin "${ADMIN}" \
  --vault_wasm_hash "${VAULT_WASM_HASH}" \
  --fee_wallet "${FEE_WALLET}" \
  --platform_fee "${PLATFORM_FEE}" \
  --identity_registry "${IDENTITY_ID}" \
  --attestation_registry "${ATTESTATION_ID}" \
  --voting_window_secs "${VOTING_WINDOW}" \
  --min_contribution "${MIN_CONTRIBUTION}"
echo "  factory configured"

# ── Verify ─────────────────────────────────────────────────────────────────
#
# Read the wiring back rather than trusting that the calls above landed. A
# factory pointing at the wrong attestation registry would fail silently until
# the first project tried to close.

echo
echo "Verifying wiring..."

check() {
  local label="$1" actual="$2" expected="$3"
  if [[ "${actual}" == "${expected}" ]]; then
    printf '  ok    %s\n' "${label}"
  else
    printf '  FAIL  %s\n        expected %s\n        got      %s\n' "${label}" "${expected}" "${actual}"
    return 1
  fi
}

read_back() {
  stellar contract invoke --id "$1" --source "${SOURCE}" --network "${NETWORK}" \
    -- "$2" 2>/dev/null | tr -d '"'
}

FAILED=0
check "factory knows the attestation registry" \
  "$(read_back "${FACTORY_ID}" get_attestation_registry)" "${ATTESTATION_ID}" || FAILED=1
check "factory knows the identity registry" \
  "$(read_back "${FACTORY_ID}" get_identity_registry)" "${IDENTITY_ID}" || FAILED=1
check "attestation registry trusts the factory" \
  "$(read_back "${ATTESTATION_ID}" get_factory)" "${FACTORY_ID}" || FAILED=1
check "factory admin is the deployer" \
  "$(read_back "${FACTORY_ID}" get_admin)" "${ADMIN}" || FAILED=1

if [[ "${FAILED}" -ne 0 ]]; then
  echo
  echo "Deployment finished with wiring errors. Do not point the app at these" >&2
  echo "contracts until they are resolved." >&2
  exit 1
fi

# ── Record ─────────────────────────────────────────────────────────────────

{
  echo "# Generated by scripts/deploy-contracts.sh"
  echo "# network: ${NETWORK}"
  echo
  echo "NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID=${FACTORY_ID}"
  echo "NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID=${ATTESTATION_ID}"
  echo "NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID=${IDENTITY_ID}"
  echo "NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID=${ADMIN_ID}"
  echo
  echo "# Vault wasm hash — the factory instantiates one vault per project"
  echo "# from this. Reviewers check a deployed vault against it."
  echo "BLKFNDR_VAULT_WASM_HASH=${VAULT_WASM_HASH}"
} > "${OUT_FILE}"

echo
echo "Wiring verified. Contract IDs written to ${OUT_FILE}."
echo
echo "Build hashes for the evidence package:"
for c in blkfndr_vault blkfndr_factory blkfndr_attestation blkfndr_identity blkfndr_admin; do
  if [[ -f "${OUT}/${c}.wasm" ]]; then
    printf '  %-22s sha256:%s\n' "${c}" "$(sha256sum "${OUT}/${c}.wasm" | cut -d' ' -f1)"
  fi
done

echo
echo "Next: copy the IDs from ${OUT_FILE} into .env.local, and register the"
echo "token contracts the platform accepts before creating any project."
