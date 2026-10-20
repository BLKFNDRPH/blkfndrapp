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
#   project-c-start  A project that misses its goal: a short raise (default
#                    five minutes, --raise-secs) with two deposits of 5 USDC
#                    against a 20 USDC goal, an overshooting deposit refused,
#                    and refunds and the bond return refused while the raise
#                    is still open.
#   project-c-finish Run once the raise has closed: anyone settles it, each
#                    backer reclaims their whole principal, the last claimant
#                    leaves the bond alone, anyone returns the bond to the
#                    builder, and the attestation reads FailedToFund.
#   project-d        A funded project whose refusals are the point: a bond
#                    below 5% of the goal, a builder without KYC approval, a
#                    builder without USDC, a deposit after the raise closed, a
#                    vote before its window opens, a window opened twice, a
#                    double vote, a vote by a non-contributor, a vote on a
#                    settled milestone, and the production registry's
#                    interface (no update, no delete). Leaves milestone 1's
#                    vote open with one approval; it lapses on its own.
#
# Usage:
#   scripts/reference-scenario.sh <step> [--network testnet] [--funder <identity>]
#                                        [--raise-secs <n>]
#
# Requires the Stellar CLI, the contracts in deployments/testnet-reference/
# contracts.env (written by scripts/deploy-contracts.sh --out), and a funder
# identity holding testnet USDC. Accounts are Stellar CLI identities named
# ref-builder, ref-c1 … ref-c5, ref-anyone, ref-nokyc and ref-nousdc, created
# on first use.

set -euo pipefail

cd "$(dirname "$0")/.."

STEP="${1:-}"
shift || true

NETWORK="testnet"
FUNDER="ba-escrow-deployer"
DEPLOYER="ref-deployer"
RAISE_SECS=300 # how long Project C's raise stays open

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)    NETWORK="$2"; shift 2 ;;
    --funder)     FUNDER="$2"; shift 2 ;;
    --deployer)   DEPLOYER="$2"; shift 2 ;;
    --raise-secs) RAISE_SECS="$2"; shift 2 ;;
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
ERR_INVALID_STATUS=2
ERR_GOAL_ALREADY_REACHED=5
ERR_NO_FUNDS_TO_REFUND=9
ERR_KYC_INVALID=12
ERR_VOTING_NOT_OPEN=15
ERR_VOTING_ALREADY_OPEN=16
ERR_ALREADY_VOTED=18
ERR_NOT_A_CONTRIBUTOR=19
ERR_THRESHOLD_NOT_MET=20
ERR_VOTING_WINDOW_NOT_ELAPSED=22
ERR_BELOW_MINIMUM_CONTRIBUTION=24
# The factory has its own error enum; its #12 is not the vault's #12.
FACTORY_ERR_BOND_BELOW_MINIMUM=12

# VaultState and Outcome are integer enums, so the CLI prints their values.
STATE_RAISING=0
STATE_FUNDED=1
STATE_FAILED=3
STATE_REFUNDING=4
STATE_COMPLETED=5
OUTCOME_COMPLETED=0
OUTCOME_FAILED_WITH_FORFEITURE=1
OUTCOME_FAILED_TO_FUND=2

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
# The CLI's output (the error and the diagnostic trace) is kept in
# LAST_REFUSAL for raised_by.
LAST_REFUSAL=""
refused() {
  local label="$1" code="$2" source="$3" id="$4"; shift 4
  local out
  if out=$(stellar contract invoke --id "${id}" --source "${source}" \
      --network "${NETWORK}" --send=no -- "$@" 2>&1); then
    echo "FAIL: ${label} was not refused" >&2
    return 1
  fi
  LAST_REFUSAL="${out}"
  if ! grep -q "Error(Contract, #${code})" <<<"${out}"; then
    echo "FAIL: ${label} was refused, but not with Error(Contract, #${code}):" >&2
    echo "${out}" >&2
    return 1
  fi
  log_tx "${label}" "refused in simulation: Error(Contract, #${code})"
}

# Simulate a call that must fail, whoever refuses it. For failures that are not
# one of our contracts' error codes, such as the token contract refusing a
# transfer. Logs the error line the CLI prints and the contract that raised it.
refused_any() {
  local label="$1" source="$2" id="$3"; shift 3
  local out line
  if out=$(stellar contract invoke --id "${id}" --source "${source}" \
      --network "${NETWORK}" --send=no -- "$@" 2>&1); then
    echo "FAIL: ${label} was not refused" >&2
    return 1
  fi
  LAST_REFUSAL="${out}"
  line=$(grep -m1 -oE 'error: .*' <<<"${out}" || true)
  log_tx "${label}" "refused in simulation: ${line#error: }; raised by $(raised_by)"
}

# The contract that raised the last refusal. Each calling frame re-raises the
# error on its way out and the trace lists the newest event first, so the
# raiser is on the oldest error event.
raised_by() {
  grep -oE 'contract:[A-Z0-9]{56}, topics:\[error' <<<"${LAST_REFUSAL}" | tail -1 \
    | cut -d: -f2 | cut -d, -f1
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

# The JSON a builder hands create_vault. Amounts in hundredths of a USDC; the
# deadline defaults to 14 days out.
vault_config() {
  local creator="$1" goal="$2" bond="$3" m1="$4" m2="$5" cid="$6"
  local deadline="${7:-$(( $(date +%s) + 14 * 24 * 60 * 60 ))}"
  echo "{
    \"creator\": \"${creator}\",
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

# create_vault <label> <goal> <bond> <m1> <m2> <cid> [deadline], by ref-builder.
create_vault() {
  local label="$1"; shift
  call "${label}" ref-builder "${FACTORY}" create_vault \
    --config "$(vault_config "$(addr ref-builder)" "$@")"
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

info_field() { read_ "$1" get_info | grep -oE "$2:-?[0-9]+" | cut -d: -f2; }

# Send USDC from --funder until a backer holds at least what a step needs.
top_up_to() {
  local label="$1" who="$2" target="$3" have need out hash
  have=$(balance "$(addr "ref-${who}")")
  need=$(( $(usdc "${target}") - ${have:-0} ))
  if (( need <= 0 )); then
    printf '  %-58s %s\n' "${label}" "not needed, holds ${have}" >&2
    return 0
  fi
  if ! out=$(stellar tx new payment --source "${FUNDER}" \
      --destination "$(addr "ref-${who}")" --asset "${USDC_ASSET}" \
      --amount "${need}" --network "${NETWORK}" 2>&1); then
    echo "FAIL: ${label}" >&2
    echo "${out}" >&2
    return 1
  fi
  hash=$(grep -oE 'Signing transaction: [0-9a-f]{64}' <<<"${out}" | awk '{print $3}')
  log_tx "${label}" "${hash:-submitted}"
}

project_c_start() {
  load_state
  [[ -n "${VAULT_B:-}" ]] || { echo "Run project-b-start first." >&2; exit 1; }
  [[ -z "${VAULT_C:-}" ]] || { echo "Project C already started (${VAULT_C})." >&2; exit 1; }

  echo "Project C: goal 20 USDC, milestones 12 + 8, bond 1 USDC, raise open for ${RAISE_SECS} s" >&2

  # c1 and c2 kept 2.5 USDC each from Project B's refunds. One deposit needs 5.
  top_up_to "C: top up c1 to 5 USDC from ${FUNDER}" c1 500
  top_up_to "C: top up c2 to 5 USDC from ${FUNDER}" c2 500

  local builder_before vault deadline
  builder_before=$(balance "$(addr ref-builder)")
  save C_BUILDER_BEFORE "${builder_before}"
  deadline=$(( $(date +%s) + RAISE_SECS ))
  vault=$(create_vault "C: create vault, lock 1 USDC bond, pay 1 USDC flat fee; raise closes in ${RAISE_SECS} s" \
    2000 100 1200 800 "blkfndr-reference/project-c" "${deadline}")
  save VAULT_C "${vault}"
  save C_DEADLINE "${deadline}"
  printf '  vault %s\n' "${vault}" >&2
  expect "C: vault holds the bond" "$(balance "${vault}")" "$(usdc 100)"
  expect "C: raising" "$(read_ "${vault}" get_state)" "${STATE_RAISING}"

  contribute "C: deposit 5 USDC (c1)" "${vault}" c1 500
  refused "C: deposit of 16 USDC refused: 5 + 16 passes the 20 USDC goal (GoalAlreadyReached)" \
    "${ERR_GOAL_ALREADY_REACHED}" ref-c2 "${vault}" contribute \
    --contributor "$(addr ref-c2)" --amount "$(usdc 1600)"
  contribute "C: deposit 5 USDC (c2)" "${vault}" c2 500
  expect "C: 10 of 20 USDC raised" "$(info_field "${vault}" raised_amount)" "$(usdc 1000)"
  expect "C: still raising" "$(read_ "${vault}" get_state)" "${STATE_RAISING}"

  # Nothing comes out while the raise is open.
  refused "C: return_bond while the raise is open refused (InvalidStatus)" \
    "${ERR_INVALID_STATUS}" ref-anyone "${vault}" return_bond
  refused "C: claim_refund while the raise is open refused (InvalidStatus)" \
    "${ERR_INVALID_STATUS}" ref-c1 "${vault}" claim_refund --contributor "$(addr ref-c1)"

  echo "The raise closes at $(date -u -d "@${deadline}" +%FT%TZ 2>/dev/null || echo "${deadline}")." >&2
  echo "Run: scripts/reference-scenario.sh project-c-finish after that." >&2
}

project_c_finish() {
  load_state
  [[ -n "${VAULT_C:-}" ]] || { echo "Run project-c-start first." >&2; exit 1; }
  local vault="${VAULT_C}" from state
  state=$(read_ "${vault}" get_state)
  if [[ "${state}" != "${STATE_FAILED}" ]]; then
    echo "The raise has not closed yet (state ${state}). It closes at" \
      "$(date -u -d "@${C_DEADLINE}" +%FT%TZ 2>/dev/null || echo "${C_DEADLINE}"). Nothing was sent." >&2
    exit 1
  fi
  # The ledger the attestation event is read from. Kept, so that a rerun after
  # a failed check still finds the event settle emitted the first time.
  if [[ -n "${C_FROM_LEDGER:-}" ]]; then
    from="${C_FROM_LEDGER}"
  else
    from=$(latest_ledger)
    save C_FROM_LEDGER "${from}"
  fi

  # The deadline passed with 10 of 20 USDC raised, so every read already says
  # Failed. settle persists it and writes the FailedToFund record.
  expect "C: the vault reads Failed before anyone settles it" "${state}" "${STATE_FAILED}"
  if [[ "$(outcome_of "${vault}")" == "${OUTCOME_FAILED_TO_FUND}" ]]; then
    printf '  %-58s %s\n' "C: already settled; the record is on the registry" "not resent" >&2
  else
    expect "C: settle returns Failed" \
      "$(call "C: settle the missed goal, by an unrelated account (attestation written)" \
        ref-anyone "${vault}" settle)" "${STATE_FAILED}"
  fi
  expect "C: attestation outcome is FailedToFund" "$(outcome_of "${vault}")" "${OUTCOME_FAILED_TO_FUND}"
  # contribute checks the lifecycle state before the deadline, so once the
  # vault reads Failed a late deposit is refused as InvalidStatus.
  refused "C: deposit after the deadline refused (InvalidStatus: the vault already reads Failed)" \
    "${ERR_INVALID_STATUS}" ref-c1 "${vault}" contribute \
    --contributor "$(addr ref-c1)" --amount "$(usdc 500)"

  # Nothing was ever released, so each backer's principal comes back whole.
  local who before
  for who in c1 c2; do
    before=$(balance "$(addr "ref-${who}")")
    call "C: refund ${who}, 5 USDC principal, with ${who}'s own signature" "ref-${who}" \
      "${vault}" claim_refund --contributor "$(addr "ref-${who}")" >/dev/null
    expect "C: ${who} received" "$(( $(balance "$(addr "ref-${who}")") - before ))" "$(usdc 500)"
  done
  refused "C: c1 claims a second time refused (NoFundsToRefund)" \
    "${ERR_NO_FUNDS_TO_REFUND}" ref-c1 "${vault}" claim_refund --contributor "$(addr ref-c1)"
  expect "C: the last claimant left the builder's bond alone; the vault still holds it" \
    "$(balance "${vault}")" "$(usdc 100)"

  before=$(balance "$(addr ref-builder)")
  call "C: return the 1 USDC bond to the builder, by an unrelated account" ref-anyone \
    "${vault}" return_bond >/dev/null
  expect "C: builder received the bond back" "$(( $(balance "$(addr ref-builder)") - before ))" "$(usdc 100)"
  refused "C: return_bond a second time refused (NoFundsToRefund)" \
    "${ERR_NO_FUNDS_TO_REFUND}" ref-anyone "${vault}" return_bond
  expect "C: vault fully drained" "$(balance "${vault}")" "0"
  expect "C: builder is down only the 1 USDC flat fee" \
    "$(( $(balance "$(addr ref-builder)") - C_BUILDER_BEFORE ))" "-$(usdc 100)"

  echo "C: attestation event, filtered by builder on Soroban RPC" >&2
  attestation_events "${from}"

  echo "Builder history, read from the registry" >&2
  expect "builder summary (completed, forfeited, unfunded)" \
    "$(read_ "${ATTESTATION}" get_builder_summary --builder "$(addr ref-builder)")" "[1,1,1]"
  read_ "${ATTESTATION}" get_builder_history --builder "$(addr ref-builder)" \
    --offset 0 --limit 10
}

# A Stellar CLI identity for one of the refusals: generated and Friendbot-funded
# on first use, with a USDC trustline so the token contract can see its balance.
ensure_account() {
  local who="$1"
  if ! stellar keys address "${who}" >/dev/null 2>&1; then
    stellar keys generate "${who}" --network "${NETWORK}" --fund >/dev/null 2>&1
  fi
  if ! stellar contract invoke --id "${USDC}" --source ref-anyone --network "${NETWORK}" \
      --send=no -- balance --id "$(addr "${who}")" >/dev/null 2>&1; then
    stellar tx new change-trust --source "${who}" --line "${USDC_ASSET}" \
      --network "${NETWORK}" >/dev/null 2>&1
  fi
  printf '  %-12s %s\n' "${who}" "$(addr "${who}")" >&2
}

# Every real step is guarded on saved or on-chain state, so a rerun after a
# failed check picks up where it stopped without resending anything.
project_d() {
  load_state
  [[ -n "${VAULT_C:-}" ]] || { echo "Run project-c-start first." >&2; exit 1; }

  echo "Project D: goal 15 USDC, milestones 10 + 5, bond 0.75 USDC, and the refusals around it" >&2

  echo "Accounts" >&2
  ensure_account ref-nokyc  # never KYC-approved
  ensure_account ref-nousdc # KYC-approved below, never sent any USDC
  if [[ "$(read_ "${IDENTITY}" is_kyc_approved --address "$(addr ref-nousdc)")" != "true" ]]; then
    call "D: KYC-approve ref-nousdc, a builder who holds no USDC" "${DEPLOYER}" "${IDENTITY}" \
      attest --attestor "$(addr "${DEPLOYER}")" --address "$(addr ref-nousdc)" \
      --kyc_hash "$(printf 'reference-scenario ref-nousdc KYC' | sha256sum | cut -d' ' -f1)" >/dev/null
  fi
  expect "D: ref-nokyc is not KYC-approved" \
    "$(read_ "${IDENTITY}" is_kyc_approved --address "$(addr ref-nokyc)")" "false"
  expect "D: ref-nousdc is KYC-approved" \
    "$(read_ "${IDENTITY}" is_kyc_approved --address "$(addr ref-nousdc)")" "true"
  expect "D: ref-nousdc holds no USDC" "$(balance "$(addr ref-nousdc)")" "0"

  # c3 kept 2.5 USDC from Project B's refund; c1 and c2 hold 5 after Project C.
  local who
  for who in c1 c2 c3; do
    top_up_to "D: top up ${who} to 5 USDC from ${FUNDER}" "${who}" 500
  done

  local vault raiser
  if [[ -z "${VAULT_D:-}" ]]; then
    # Three ways a vault is not created. Each is simulated against the factory
    # and refused before anything is deployed or any USDC moves.
    refused "D: create_vault with a 0.70 USDC bond on a 15 USDC goal refused (factory BondBelowMinimum: 5% is 0.75)" \
      "${FACTORY_ERR_BOND_BELOW_MINIMUM}" ref-builder "${FACTORY}" create_vault \
      --config "$(vault_config "$(addr ref-builder)" 1500 70 1000 500 "blkfndr-reference/project-d")"
    expect "D: the bond refusal was raised by the factory itself" "$(raised_by)" "${FACTORY}"

    refused "D: create_vault by a builder without KYC approval refused (vault KYCInvalid)" \
      "${ERR_KYC_INVALID}" ref-nokyc "${FACTORY}" create_vault \
      --config "$(vault_config "$(addr ref-nokyc)" 1500 75 1000 500 "blkfndr-reference/project-d")"
    raiser=$(raised_by)
    if [[ -z "${raiser}" || "${raiser}" == "${FACTORY}" ]]; then
      echo "FAIL: D: KYCInvalid was expected from the new vault, got it from '${raiser}':" >&2
      echo "${LAST_REFUSAL}" >&2
      return 1
    fi
    expect "D: KYCInvalid was raised inside the new vault's initialize" \
      "$(grep -c "fn_call, ${raiser}, initialize" <<<"${LAST_REFUSAL}")" "1"
    log_tx "D: the KYC refusal came from the vault the factory was deploying" \
      "contract ${raiser}, in initialize"

    refused_any "D: create_vault by a KYC-approved builder who holds no USDC fails in the bond transfer" \
      ref-nousdc "${FACTORY}" create_vault \
      --config "$(vault_config "$(addr ref-nousdc)" 1500 75 1000 500 "blkfndr-reference/project-d")"
    expect "D: that failure was raised by the USDC token contract" "$(raised_by)" "${USDC}"

    vault=$(create_vault "D: create vault, lock 0.75 USDC bond, pay 1 USDC flat fee" \
      1500 75 1000 500 "blkfndr-reference/project-d")
    save VAULT_D "${vault}"
    printf '  vault %s\n' "${vault}" >&2
    expect "D: vault holds the bond" "$(balance "${vault}")" "$(usdc 75)"
  else
    vault="${VAULT_D}"
    printf '  vault %s (already created)\n' "${vault}" >&2
  fi

  if [[ "$(read_ "${vault}" get_state)" == "${STATE_RAISING}" ]]; then
    for who in c1 c2 c3; do
      if [[ "$(read_ "${vault}" get_balance --contributor "$(addr "ref-${who}")")" == "0" ]]; then
        contribute "D: deposit 5 USDC (${who})" "${vault}" "${who}" 500
      fi
    done
  fi
  expect "D: goal met on the third deposit, raise closed" "$(read_ "${vault}" get_state)" "${STATE_FUNDED}"
  expect "D: vault holds 15 USDC raised + 0.75 USDC bond" "$(balance "${vault}")" "$(usdc 1575)"
  refused "D: deposit 5 USDC after the raise closed refused (InvalidStatus)" \
    "${ERR_INVALID_STATUS}" ref-c1 "${vault}" contribute \
    --contributor "$(addr ref-c1)" --amount "$(usdc 500)"

  # Milestone 1's vote: refused before it opens, opened once, then the refusals
  # around one real approval.
  if [[ -z "${D_M1_OPENED_AT:-}" ]]; then
    refused "D: c1 approves milestone 1 before its vote is open refused (VotingNotOpen)" \
      "${ERR_VOTING_NOT_OPEN}" ref-c1 "${vault}" approve_milestone \
      --contributor "$(addr ref-c1)" --milestone_id 1
    call "D: open milestone 1 vote (builder; window 7 days)" ref-builder "${vault}" \
      open_milestone_vote --milestone_id 1 >/dev/null
    save D_M1_OPENED_AT "$(date -u +%s)"
  else
    printf '  %-58s %s\n' "D: milestone 1 vote already open" "not reopened" >&2
  fi
  refused "D: builder opens milestone 1's vote a second time refused (VotingAlreadyOpen)" \
    "${ERR_VOTING_ALREADY_OPEN}" ref-builder "${vault}" open_milestone_vote --milestone_id 1

  if [[ "$(read_ "${vault}" has_voted --milestone_id 1 --contributor "$(addr ref-c1)")" != "true" ]]; then
    approve "D: approve milestone 1 (c1)" "${vault}" c1 1
  fi
  refused "D: c1 approves milestone 1 a second time refused (AlreadyVoted)" \
    "${ERR_ALREADY_VOTED}" ref-c1 "${vault}" approve_milestone \
    --contributor "$(addr ref-c1)" --milestone_id 1
  refused "D: an account that never deposited approves milestone 1 refused (NotAContributor)" \
    "${ERR_NOT_A_CONTRIBUTOR}" ref-anyone "${vault}" approve_milestone \
    --contributor "$(addr ref-anyone)" --milestone_id 1

  # A vote on a milestone whose window has closed. Project B's milestone 2
  # lapsed and was settled on 2026-10-13, so that vault reads Refunding and the
  # lifecycle check refuses the vote before the window check (#17) is reached.
  refused "D: c2 approves Project B's settled milestone 2 refused (InvalidStatus: that vault is Refunding)" \
    "${ERR_INVALID_STATUS}" ref-c2 "${VAULT_B}" approve_milestone \
    --contributor "$(addr ref-c2)" --milestone_id 2

  echo "Production attestation registry: its whole interface" >&2
  local production_registry fns
  production_registry=$(grep '^NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID=' \
    deployments/testnet-production/contracts.env | cut -d= -f2 | tr -d '\r')
  fns=$(stellar contract info interface --id "${production_registry}" --network "${NETWORK}" 2>/dev/null \
    | grep -oE '^\s*fn [a-z_]+' | awk '{print $2}' | tr '\n' ' ')
  [[ -n "${fns}" ]] || { echo "FAIL: D: could not read the production registry's interface" >&2; return 1; }
  printf '  %s\n' "${fns}" >&2
  expect "D: production registry has no update, delete or amend entrypoint" \
    "$(grep -cE 'update|delete|remove|amend|set_record' <<<"${fns}")" "0"
  log_tx "D: production registry ${production_registry} interface (no update, no delete)" "${fns% }"

  local closes
  closes=$(( $(grep '^D_M1_OPENED_AT=' "${STATE}" | cut -d= -f2 | tr -d '\r') + 7 * 24 * 60 * 60 ))
  echo "Milestone 1's vote stays open until $(date -u -d "@${closes}" +%FT%TZ 2>/dev/null || echo "${closes}")." >&2
  echo "With one approval behind it, it lapses on its own; nothing here settles it." >&2
}

case "${STEP}" in
  setup)            setup ;;
  project-a)        project_a ;;
  project-b-start)  project_b_start ;;
  project-b-finish) project_b_finish ;;
  project-c-start)  project_c_start ;;
  project-c-finish) project_c_finish ;;
  project-d)        project_d ;;
  *) sed -n '2,51p' "$0"; exit 1 ;;
esac
