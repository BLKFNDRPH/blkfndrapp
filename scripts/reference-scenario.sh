#!/usr/bin/env bash
#
# Drive the reference deployment through every path the vault offers, on
# testnet, with real Circle testnet USDC: deposit, the $5 minimum, the 20%
# weight cap, threshold approval, permissionless release, the fail-closed lapse,
# pro-rata refunds with the forfeited bond, and the builder attestation.
#
# Every submitted transaction is appended to deployments/testnet-reference/
# transactions.tsv. Calls that must be refused are simulated (--send=no), and
# the run fails unless the contract refuses them with the expected error.
#
# The steps, in order:
#
#   setup            Create and fund the accounts, add USDC trustlines, send
#                    USDC from --funder, and KYC-approve the builder.
#   project-a        A project that completes: two milestones released, the
#                    bond returned, a Completed attestation written.
#   project-b-start  A project that will fail closed: milestone 1 released,
#                    milestone 2's vote opened with one approval.
#   project-b-finish Run once milestone 2's 7-day window has closed: anyone
#                    settles the lapse, the bond is forfeited, every backer
#                    reclaims their pro-rata share, and the attestation reads
#                    FailedWithForfeiture.
#
# Usage:
#   scripts/reference-scenario.sh <step> [--network testnet] [--funder <identity>]
#
# Requires the Stellar CLI, the contracts in deployments/testnet-reference/
# contracts.env (written by scripts/deploy-contracts.sh --out), and a funder
# identity holding testnet USDC. Accounts are Stellar CLI identities named
# ref-builder, ref-c1 … ref-c5 and ref-anyone, created on first use.

set -euo pipefail

cd "$(dirname "$0")/.."

STEP="${1:-}"
shift || true

NETWORK="testnet"
FUNDER="ba-escrow-deployer"
DEPLOYER="ref-deployer"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)  NETWORK="$2"; shift 2 ;;
    --funder)   FUNDER="$2"; shift 2 ;;
    --deployer) DEPLOYER="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

DIR=deployments/testnet-reference
CONTRACTS="${DIR}/contracts.env"
STATE="${DIR}/scenario.env"
TX_LOG="${DIR}/transactions.tsv"
RPC_URL="https://soroban-testnet.stellar.org"

# Circle's testnet USDC and its Stellar Asset Contract.
USDC_ASSET="USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
USDC="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
UNIT=10000000 # 7 decimals

# shellcheck source=/dev/null
source "${CONTRACTS}"
FACTORY="${NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID}"
ATTESTATION="${NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID}"
IDENTITY="${NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID}"

# Contract error codes this run expects to see.
ERR_THRESHOLD_NOT_MET=20
ERR_VOTING_WINDOW_NOT_ELAPSED=22
ERR_BELOW_MINIMUM_CONTRIBUTION=24

# VaultState and Outcome are integer enums, so the CLI prints their values.
STATE_FUNDED=1
STATE_REFUNDING=4
STATE_COMPLETED=5
OUTCOME_COMPLETED=0
OUTCOME_FAILED_WITH_FORFEITURE=1

# ── Helpers ────────────────────────────────────────────────────────────────

addr() { stellar keys address "$1"; }

usdc() { echo $(( $1 * UNIT / 100 )); } # hundredths of a USDC -> base units

log_tx() {
  printf '%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$1" "$2" >> "${TX_LOG}"
  printf '  %-58s %s\n' "$1" "$2" >&2
}

# Submit a contract call, log its transaction, and print its return value.
call() {
  local label="$1" source="$2" id="$3"; shift 3
  local err out hash
  err=$(mktemp)
  if ! out=$(stellar contract invoke --id "${id}" --source "${source}" \
      --network "${NETWORK}" -- "$@" 2>"${err}"); then
    echo "FAIL: ${label}" >&2
    cat "${err}" >&2
    rm -f "${err}"
    return 1
  fi
  hash=$(grep -oE 'tx/[0-9a-f]{64}' "${err}" | tail -1 | cut -d/ -f2 || true)
  rm -f "${err}"
  [[ -n "${hash}" ]] || { echo "FAIL: ${label} was not submitted" >&2; return 1; }
  log_tx "${label}" "${hash}"
  printf '%s' "${out}" | tr -d '"'
}

# Simulate a call the contract must refuse, and check which error refused it.
refused() {
  local label="$1" code="$2" source="$3" id="$4"; shift 4
  local out
  if out=$(stellar contract invoke --id "${id}" --source "${source}" \
      --network "${NETWORK}" --send=no -- "$@" 2>&1); then
    echo "FAIL: ${label} was not refused" >&2
    return 1
  fi
  if ! grep -q "Error(Contract, #${code})" <<<"${out}"; then
    echo "FAIL: ${label} was refused, but not with Error(Contract, #${code}):" >&2
    echo "${out}" >&2
    return 1
  fi
  log_tx "${label}" "refused in simulation: Error(Contract, #${code})"
}

# A read: simulated, never submitted.
read_() {
  local id="$1"; shift
  stellar contract invoke --id "${id}" --source ref-anyone \
    --network "${NETWORK}" --send=no -- "$@" 2>/dev/null | tr -d '"'
}

expect() {
  local label="$1" actual="$2" expected="$3"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "FAIL: ${label}: expected ${expected}, got ${actual}" >&2
    return 1
  fi
  printf '  %-58s %s\n' "check: ${label}" "${actual}" >&2
}

balance() { read_ "${USDC}" balance --id "$1"; }

outcome_of() {
  read_ "${ATTESTATION}" get_record --vault "$1" | grep -oE 'outcome:[0-9]+' | cut -d: -f2
}

latest_ledger() {
  curl -s -X POST "${RPC_URL}" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' \
    | grep -oE '"sequence":[0-9]+' | cut -d: -f2
}

save() { echo "$1=$2" >> "${STATE}"; }

load_state() {
  [[ -f "${STATE}" ]] || { echo "No ${STATE}; run the earlier steps first." >&2; exit 1; }
  # shellcheck source=/dev/null
  source "${STATE}"
}

scval() {
  echo "$1" | stellar xdr encode --type ScVal --input json --output single-base64
}

# The builder's attestation events, filtered on Soroban RPC by the builder
# topic alone. RPC retains events for about a week, so each project's event is
# read in the step that emits it; the record in contract storage is permanent.
attestation_events() {
  local from="$1" builder
  builder=$(addr ref-builder)
  stellar events --network "${NETWORK}" --start-ledger "${from}" \
    --id "${ATTESTATION}" --output json \
    --topic "$(scval '{"symbol":"ATTEST"}'),$(scval '{"symbol":"RECORDED"}'),$(scval "{\"address\":\"${builder}\"}")"
}

# ── Steps ──────────────────────────────────────────────────────────────────

setup() {
  mkdir -p "${DIR}"
  [[ -f "${TX_LOG}" ]] || printf 'utc\tstep\ttransaction\n' > "${TX_LOG}"

  echo "Accounts" >&2
  for who in builder c1 c2 c3 c4 c5 anyone; do
    if ! stellar keys address "ref-${who}" >/dev/null 2>&1; then
      stellar keys generate "ref-${who}" --network "${NETWORK}" --fund >/dev/null 2>&1
    fi
    printf '  %-12s %s\n' "ref-${who}" "$(addr "ref-${who}")" >&2
  done

  echo "USDC trustlines and funding from ${FUNDER}" >&2
  local who amount out
  for spec in builder:5 c1:15 c2:10 c3:10 c4:10 c5:10; do
    who="${spec%%:*}"; amount="${spec#*:}"
    stellar tx new change-trust --source "ref-${who}" --line "${USDC_ASSET}" \
      --network "${NETWORK}" >/dev/null 2>&1
    out=$(stellar tx new payment --source "${FUNDER}" \
      --destination "$(addr "ref-${who}")" --asset "${USDC_ASSET}" \
      --amount "$(( amount * UNIT ))" --network "${NETWORK}" 2>&1)
    log_tx "setup: send ${amount} USDC to ref-${who}" \
      "$(grep -oE 'Signing transaction: [0-9a-f]{64}' <<<"${out}" | awk '{print $3}')"
  done

  echo "KYC" >&2
  local kyc_hash
  kyc_hash=$(printf 'reference-scenario builder KYC' | sha256sum | cut -d' ' -f1)
  call "setup: KYC-approve the builder" "${DEPLOYER}" "${IDENTITY}" \
    attest --attestor "$(addr "${DEPLOYER}")" --address "$(addr ref-builder)" \
    --kyc_hash "${kyc_hash}" >/dev/null
  expect "builder is KYC-approved" \
    "$(read_ "${IDENTITY}" is_kyc_approved --address "$(addr ref-builder)")" "true"
}

create_vault() {
  local label="$1" goal="$2" bond="$3" m1="$4" m2="$5" cid="$6"
  local deadline=$(( $(date +%s) + 14 * 24 * 60 * 60 ))
  call "${label}" ref-builder "${FACTORY}" create_vault --config "{
    \"creator\": \"$(addr ref-builder)\",
    \"token\": \"${USDC}\",
    \"goal\": \"$(usdc "${goal}")\",
    \"deadline\": ${deadline},
    \"bond_amount\": \"$(usdc "${bond}")\",
    \"milestones\": [
      {\"id\": 1, \"amount\": \"$(usdc "${m1}")\"},
      {\"id\": 2, \"amount\": \"$(usdc "${m2}")\"}
    ],
    \"metadata_cid\": \"${cid}\"
  }"
}

contribute() {
  local label="$1" vault="$2" who="$3" cents="$4"
  call "${label}" "ref-${who}" "${vault}" contribute \
    --contributor "$(addr "ref-${who}")" --amount "$(usdc "${cents}")" >/dev/null
}

approve() {
  local label="$1" vault="$2" who="$3" milestone="$4"
  call "${label}" "ref-${who}" "${vault}" approve_milestone \
    --contributor "$(addr "ref-${who}")" --milestone_id "${milestone}" >/dev/null
}

project_a() {
  [[ -f "${STATE}" ]] && grep -q '^VAULT_A=' "${STATE}" && {
    echo "Project A already ran (${STATE})." >&2; exit 1; }

  save START_LEDGER "$(latest_ledger)"
  echo "Project A: goal 30 USDC, milestones 18 + 12, bond 3 USDC" >&2
  local builder_before vault
  builder_before=$(balance "$(addr ref-builder)")
  vault=$(create_vault "A: create vault, lock 3 USDC bond, pay 1 USDC flat fee" \
    3000 300 1800 1200 "blkfndr-reference/project-a")
  save VAULT_A "${vault}"
  printf '  vault %s\n' "${vault}" >&2
  expect "A: vault holds the bond" "$(balance "${vault}")" "$(usdc 300)"

  refused "A: deposit of 4.99 USDC refused (BelowMinimumContribution)" \
    "${ERR_BELOW_MINIMUM_CONTRIBUTION}" ref-c2 "${vault}" contribute \
    --contributor "$(addr ref-c2)" --amount "$(usdc 499)"
  contribute "A: deposit 10 USDC (c1)" "${vault}" c1 1000
  for who in c2 c3 c4 c5; do
    contribute "A: deposit 5 USDC (${who})" "${vault}" "${who}" 500
  done
  expect "A: goal met, raise closed" "$(read_ "${vault}" get_state)" "${STATE_FUNDED}"
  expect "A: c1 put in 10 USDC but votes with 6 (20% cap)" \
    "$(read_ "${vault}" get_voting_weight --contributor "$(addr ref-c1)")" "$(usdc 600)"

  # Milestone 1. Capped total 6 + 4 × 5 = 26, so the weight bar is above 13.
  call "A: open milestone 1 vote (builder; window 7 days)" ref-builder "${vault}" \
    open_milestone_vote --milestone_id 1 >/dev/null
  approve "A: approve milestone 1 (c1, weight 6)" "${vault}" c1 1
  approve "A: approve milestone 1 (c2, weight 5)" "${vault}" c2 1
  refused "A: release milestone 1 on two approvals refused (ThresholdNotMet)" \
    "${ERR_THRESHOLD_NOT_MET}" ref-anyone "${vault}" release_milestone --milestone_id 1
  approve "A: approve milestone 1 (c3, weight 5)" "${vault}" c3 1
  call "A: release milestone 1, 18 USDC, by an unrelated account" ref-anyone "${vault}" \
    release_milestone --milestone_id 1 >/dev/null

  # Milestone 2. Three 5 USDC wallets clear the weight (15 > 13) and the
  # wallet floor, but hold exactly half the money, not more than half.
  call "A: open milestone 2 vote (builder)" ref-builder "${vault}" \
    open_milestone_vote --milestone_id 2 >/dev/null
  for who in c3 c4 c5; do
    approve "A: approve milestone 2 (${who}, weight 5)" "${vault}" "${who}" 2
  done
  expect "A: approvers hold 15 of 30 USDC; a release needs more than 15" \
    "$(read_ "${vault}" get_milestone_stake --milestone_id 2)" \
    "[$(usdc 1500),$(( $(usdc 1500) + 1 ))]"
  refused "A: release milestone 2 on half the money refused (ThresholdNotMet)" \
    "${ERR_THRESHOLD_NOT_MET}" ref-anyone "${vault}" release_milestone --milestone_id 2
  approve "A: approve milestone 2 (c1, weight 6)" "${vault}" c1 2
  call "A: release milestone 2, 12 USDC + bond back, attestation written" ref-anyone \
    "${vault}" release_milestone --milestone_id 2 >/dev/null

  expect "A: project completed" "$(read_ "${vault}" get_state)" "${STATE_COMPLETED}"
  expect "A: vault fully drained" "$(balance "${vault}")" "0"
  expect "A: builder received 30 USDC raised + 3 bond, less 3 bond + 1 fee" \
    "$(( $(balance "$(addr ref-builder)") - builder_before ))" "$(usdc 2900)"
  expect "A: attestation outcome is Completed" "$(outcome_of "${vault}")" "${OUTCOME_COMPLETED}"

  echo "A: attestation event, filtered by builder on Soroban RPC" >&2
  attestation_events "${START_LEDGER:-$(grep '^START_LEDGER=' "${STATE}" | cut -d= -f2)}"
}

project_b_start() {
  load_state
  [[ -n "${VAULT_A:-}" ]] || { echo "Run project-a first." >&2; exit 1; }
  [[ -z "${VAULT_B:-}" ]] || { echo "Project B already started (${VAULT_B})." >&2; exit 1; }

  echo "Project B: goal 25 USDC, milestones 15 + 10, bond 2.5 USDC" >&2
  local vault
  vault=$(create_vault "B: create vault, lock 2.5 USDC bond, pay 1 USDC flat fee" \
    2500 250 1500 1000 "blkfndr-reference/project-b")
  save VAULT_B "${vault}"
  printf '  vault %s\n' "${vault}" >&2

  for who in c1 c2 c3 c4 c5; do
    contribute "B: deposit 5 USDC (${who})" "${vault}" "${who}" 500
  done
  expect "B: goal met, raise closed" "$(read_ "${vault}" get_state)" "${STATE_FUNDED}"

  call "B: open milestone 1 vote (builder)" ref-builder "${vault}" \
    open_milestone_vote --milestone_id 1 >/dev/null
  for who in c1 c2 c3; do
    approve "B: approve milestone 1 (${who})" "${vault}" "${who}" 1
  done
  call "B: release milestone 1, 15 USDC, by an unrelated account" ref-anyone "${vault}" \
    release_milestone --milestone_id 1 >/dev/null

  call "B: open milestone 2 vote (builder; window 7 days)" ref-builder "${vault}" \
    open_milestone_vote --milestone_id 2 >/dev/null
  save B_M2_OPENED_AT "$(date -u +%s)"
  approve "B: approve milestone 2 (c1 only)" "${vault}" c1 2
  refused "B: settling milestone 2 early refused (VotingWindowNotElapsed)" \
    "${ERR_VOTING_WINDOW_NOT_ELAPSED}" ref-anyone "${vault}" \
    settle_lapsed_milestone --milestone_id 2

  local closes
  closes=$(( $(grep '^B_M2_OPENED_AT=' "${STATE}" | cut -d= -f2) + 7 * 24 * 60 * 60 ))
  echo "Milestone 2's window closes at $(date -u -d "@${closes}" +%FT%TZ 2>/dev/null || echo "${closes}")." >&2
  echo "Run: scripts/reference-scenario.sh project-b-finish after that." >&2
}

project_b_finish() {
  load_state
  [[ -n "${VAULT_B:-}" ]] || { echo "Run project-b-start first." >&2; exit 1; }
  local vault="${VAULT_B}" from
  from=$(latest_ledger)

  call "B: settle lapsed milestone 2 (fails closed; bond forfeited; attestation)" \
    ref-anyone "${vault}" settle_lapsed_milestone --milestone_id 2 >/dev/null
  expect "B: refunding" "$(read_ "${vault}" get_state)" "${STATE_REFUNDING}"
  expect "B: attestation outcome is FailedWithForfeiture" \
    "$(outcome_of "${vault}")" "${OUTCOME_FAILED_WITH_FORFEITURE}"

  # Each backer put in 5 of 25: 5/25 of the 10 USDC left after milestone 1 is
  # 2 USDC, and 5/25 of the 2.5 USDC bond is 0.5 USDC.
  local who before
  for who in c1 c2 c3 c4 c5; do
    before=$(balance "$(addr "ref-${who}")")
    call "B: refund ${who} (2 USDC remaining + 0.5 USDC forfeited bond)" "ref-${who}" \
      "${vault}" claim_refund --contributor "$(addr "ref-${who}")" >/dev/null
    expect "B: ${who} received" "$(( $(balance "$(addr "ref-${who}")") - before ))" "$(usdc 250)"
  done
  expect "B: vault fully drained" "$(balance "${vault}")" "0"

  echo "B: attestation event, filtered by builder on Soroban RPC" >&2
  attestation_events "${from}"

  echo "Builder history, read from the registry" >&2
  expect "builder summary (completed, forfeited, unfunded)" \
    "$(read_ "${ATTESTATION}" get_builder_summary --builder "$(addr ref-builder)")" "[1,1,0]"
  read_ "${ATTESTATION}" get_builder_history --builder "$(addr ref-builder)" \
    --offset 0 --limit 10
}

case "${STEP}" in
  setup)            setup ;;
  project-a)        project_a ;;
  project-b-start)  project_b_start ;;
  project-b-finish) project_b_finish ;;
  *) sed -n '2,32p' "$0"; exit 1 ;;
esac
