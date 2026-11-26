#!/usr/bin/env bash
#
# Deploy the report-anchor registry (Sprint 2, item 1.3) into an existing
# deployment set, and put the attestor key on its roster.
#
# The registry stands alone: nothing else in the set calls it, and it does not
# call the factory (docs/design/risk-report-anchor.md, "The vault is not
# checked against the factory"). So it is added to a set beside the others,
# not folded into deploy-contracts.sh, whose order exists for the factory's
# constructor.
#
# D1 (2026-11-25): anchors are signed by a dedicated attestor key, not the ops
# key. Create one with
#   stellar keys generate report-attestor --network testnet --fund
# and give its secret to the app as RISK_ATTESTOR_SECRET.
#
# Usage:
#   scripts/deploy-report-anchor.sh --set testnet-reference --source ref-deployer --attestor report-attestor
#   scripts/deploy-report-anchor.sh --set testnet-production --source ba-escrow-deployer --attestor report-attestor
#
# Appends NEXT_PUBLIC_BLKFNDR_REPORT_ANCHOR_CONTRACT_ID to
# deployments/<set>/contracts.env and prints the deploy's wasm hash.

set -euo pipefail
cd "$(dirname "$0")/.."

NETWORK="testnet"
SET=""
SOURCE=""
ATTESTOR=""
SKIP_BUILD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)    NETWORK="$2"; shift 2 ;;
    --set)        SET="$2"; shift 2 ;;
    --source)     SOURCE="$2"; shift 2 ;;
    --attestor)   ATTESTOR="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help)    sed -n 2,23p "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[[ -n "${SET}" && -n "${SOURCE}" && -n "${ATTESTOR}" ]] || {
  echo "--set, --source and --attestor are required (see --help)" >&2; exit 2;
}
ENV_FILE="deployments/${SET}/contracts.env"
[[ -f "${ENV_FILE}" ]] || { echo "No such deployment set: ${ENV_FILE}" >&2; exit 2; }
if grep -q '^NEXT_PUBLIC_BLKFNDR_REPORT_ANCHOR_CONTRACT_ID=' "${ENV_FILE}"; then
  echo "${ENV_FILE} already has a report-anchor registry; remove the line to deploy a new one." >&2
  exit 2
fi

# An identity name or a G… address.
address_of() { [[ "$1" == G* ]] && echo "$1" || stellar keys address "$1"; }
ADMIN_ADDR=$(address_of "${SOURCE}")
ATTESTOR_ADDR=$(address_of "${ATTESTOR}")

WASM=target/wasm32-unknown-unknown/release/blkfndr_report_anchor.wasm
if [[ -z "${SKIP_BUILD}" ]]; then
  echo "Building contracts..."
  bash scripts/build-contracts.sh >/dev/null
fi
[[ -f "${WASM}" ]] || { echo "Missing ${WASM}" >&2; exit 1; }
WASM_SHA=$(sha256sum "${WASM}" | cut -d' ' -f1)
echo "wasm sha256: ${WASM_SHA}"

echo "Deploying the report-anchor registry (admin ${ADMIN_ADDR})..."
ANCHOR_ID=$(stellar contract deploy \
  --wasm "${WASM}" \
  --source "${SOURCE}" \
  --network "${NETWORK}" \
  -- --admin "${ADMIN_ADDR}" | tail -1)
[[ "${ANCHOR_ID}" == C* ]] || { echo "Deploy did not return a contract id: ${ANCHOR_ID}" >&2; exit 1; }
echo "  ${ANCHOR_ID}"

echo "Adding attestor ${ATTESTOR_ADDR}..."
stellar contract invoke --id "${ANCHOR_ID}" --source "${SOURCE}" --network "${NETWORK}" \
  -- add_attestor --attestor "${ATTESTOR_ADDR}" >/dev/null

echo "Checking..."
[[ "$(stellar contract invoke --id "${ANCHOR_ID}" --source "${SOURCE}" --network "${NETWORK}" \
  -- is_attestor --address "${ATTESTOR_ADDR}")" == "true" ]] || { echo "Attestor not on the roster" >&2; exit 1; }
[[ "$(stellar contract invoke --id "${ANCHOR_ID}" --source "${SOURCE}" --network "${NETWORK}" \
  -- get_admin | tr -d '"')" == "${ADMIN_ADDR}" ]] || { echo "Admin is not ${ADMIN_ADDR}" >&2; exit 1; }

cat >> "${ENV_FILE}" <<EOF

# Report-anchor registry (scripts/deploy-report-anchor.sh, $(date -u +%Y-%m-%d)).
# Admin ${ADMIN_ADDR}; attestor ${ATTESTOR_ADDR}; wasm sha256 ${WASM_SHA}.
NEXT_PUBLIC_BLKFNDR_REPORT_ANCHOR_CONTRACT_ID=${ANCHOR_ID}
EOF
echo "Wrote ${ENV_FILE}"
