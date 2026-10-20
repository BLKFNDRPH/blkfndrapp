#!/usr/bin/env bash
#
# The first payout on a live project: three scripted stakeholder wallets back a
# small project on the app's own factory, approve its one stage once the
# builder opens the vote, and the governance keeper sends the payout. The
# builder's two steps, launching the project and opening the vote, are done in
# the app with the builder's own wallet. This script does everything else and
# checks each result as it goes.
#
# Steps, in order:
#
#   setup                 Create and fund pay-s1, pay-s2, pay-s3 and pay-anyone:
#                         Friendbot XLM, a USDC trustline, and 5 USDC each for
#                         the stakers from --funder.
#   status <project-id>   Read the vault: state, raise, stages, votes, record.
#                         Never sends anything.
#   stake <project-id>    Three stakes of 5 USDC. With a 15 USDC goal the third
#                         one reaches it and the raise closes.
#   approve <project-id>  Three approvals of the open stage vote, then the
#                         weight, wallet and money conditions, and whether the
#                         vault would accept a release.
#   watch <project-id>    Poll until the stage is paid (the keeper's release),
#                         then print the release transaction, the Completed
#                         record and the builder's summary.
#   release <project-id>  Fallback only: send release_milestone from pay-anyone
#                         if the keeper has not within about 20 minutes.
#   keeper-dry-run        Ask the live app's governance keeper what is due. It
#                         sends nothing. Needs INDEXER_SECRET from --env-file.
#
# Usage:
#   scripts/payout-run.sh <step> [<project-id>] [--dry-run] [--milestone <id>]
#                         [--network testnet] [--funder <identity>]
#                         [--env-file .env.local] [--app <url>]
#
# --dry-run simulates every write and sends nothing, so stake and approve can be
# rehearsed against a real vault first. Every submitted transaction is appended
# to deployments/testnet-production/payout-run.tsv.

set -euo pipefail

cd "$(dirname "$0")/.."

STEP="${1:-}"
shift || true

PROJECT_ID=""
if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  PROJECT_ID="$1"
  shift
fi

NETWORK="testnet"
FUNDER="ba-escrow-deployer"
DRY_RUN=0
MILESTONE=""
ENV_FILE=".env.local"
APP_URL="https://testnetv2.blkfndr.com"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=1; shift ;;
    --milestone) MILESTONE="$2"; shift 2 ;;
    --network)   NETWORK="$2"; shift 2 ;;
    --funder)    FUNDER="$2"; shift 2 ;;
    --env-file)  ENV_FILE="$2"; shift 2 ;;
    --app)       APP_URL="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

DIR=deployments/testnet-production
CONTRACTS="${DIR}/contracts.env"
STATE="${DIR}/payout-run.env"
TX_LOG="${DIR}/payout-run.tsv"
RPC_URL="https://soroban-testnet.stellar.org"

# Circle's testnet USDC and its Stellar Asset Contract.
USDC_ASSET="USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
USDC="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
UNIT=10000000 # 7 decimals
STAKE=$(( 5 * UNIT ))

# shellcheck source=/dev/null
source "${CONTRACTS}"
FACTORY="${NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID}"
ATTESTATION="${NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID}"

STAKERS=(s1 s2 s3)

# VaultState and Outcome are integer enums, so the CLI prints their values.
STATE_RAISING=0
STATE_FUNDED=1
STATE_ACTIVE=2
STATE_COMPLETED=5
OUTCOME_COMPLETED=0

# ── Helpers ────────────────────────────────────────────────────────────────

addr() { stellar keys address "$1"; }

say() { printf '  %-58s %s\n' "$1" "$2" >&2; }

log_tx() {
  [[ -f "${TX_LOG}" ]] || printf 'utc\tstep\ttransaction\n' > "${TX_LOG}"
  printf '%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$1" "$2" >> "${TX_LOG}"
  say "$1" "$2"
}

# Submit a contract call, log its transaction, and print its return value.
# With --dry-run it is simulated only: the vault's acceptance is the result.
call() {
  local label="$1" source="$2" id="$3"; shift 3
  local err out hash
  err=$(mktemp)
  if (( DRY_RUN )); then
    if ! out=$(stellar contract invoke --id "${id}" --source "${source}" \
        --network "${NETWORK}" --send=no -- "$@" 2>"${err}"); then
      echo "FAIL (dry run): ${label}" >&2
      cat "${err}" >&2
      rm -f "${err}"
      return 1
    fi
    rm -f "${err}"
    say "${label}" "dry run: accepted in simulation, nothing sent"
    printf '%s' "${out}" | tr -d '"'
    return 0
  fi
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

# A read: simulated, never submitted.
read_() {
  local id="$1"; shift
  stellar contract invoke --id "${id}" --source pay-anyone \
    --network "${NETWORK}" --send=no -- "$@" 2>/dev/null | tr -d '"' || true
}

# Does the vault accept this call right now? Simulated, never submitted.
accepts() {
  local id="$1"; shift
  stellar contract invoke --id "${id}" --source pay-anyone \
    --network "${NETWORK}" --send=no -- "$@" >/dev/null 2>&1
}

expect() {
  local label="$1" actual="$2" expected="$3"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "FAIL: ${label}: expected ${expected}, got ${actual}" >&2
    return 1
  fi
  say "check: ${label}" "${actual}"
}

balance() { read_ "${USDC}" balance --id "$1"; }

info_field() { read_ "$1" get_info | grep -oE "$2:-?[0-9A-Za-z]+" | head -1 | cut -d: -f2 || true; }

# The stage ids a vault was created with, in order. After the quotes are
# stripped, a stage's id is the only "id:" preceded by a brace or a comma;
# project_id is preceded by an underscore.
stage_ids() { read_ "$1" get_info | grep -oE '[{,]id:[0-9]+' | sed 's/^.//' | cut -d: -f2 || true; }

# The first stage not yet paid or failed, read from the vault's own stages.
next_stage() {
  local vault="$1" info
  info=$(read_ "${vault}" get_info)
  # One stage per {...} block inside milestones:[...].
  grep -oE '\{[^{}]*\}' <<<"${info}" | while read -r block; do
    grep -q 'released:false' <<<"${block}" || continue
    grep -q 'failed:true' <<<"${block}" && continue
    grep -oE '[{,]id:[0-9]+' <<<"${block}" | sed 's/^.//' | cut -d: -f2 | head -1
    break
  done
}

vault_of() {
  local vault
  vault=$(read_ "${FACTORY}" get_vault --project_id "$1" || true)
  [[ "${vault}" == C* ]] || { echo "No vault for project #$1 on factory ${FACTORY}." >&2; exit 1; }
  echo "${vault}"
}

need_project() {
  [[ -n "${PROJECT_ID}" ]] || { echo "This step needs a project id: scripts/payout-run.sh ${STEP} <project-id>" >&2; exit 1; }
}

latest_ledger() {
  curl -s -X POST "${RPC_URL}" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' \
    | grep -oE '"sequence":[0-9]+' | cut -d: -f2
}

save() { mkdir -p "${DIR}"; echo "$1=$2" >> "${STATE}"; }

load_state() {
  [[ -f "${STATE}" ]] || return 0
  # shellcheck source=/dev/null
  source "${STATE}"
}

scval() {
  echo "$1" | stellar xdr encode --type ScVal --input json --output single-base64
}

# Events of one kind from one vault since a ledger, as JSON lines.
vault_events() {
  local vault="$1" from="$2" a="$3" b="$4"
  stellar events --network "${NETWORK}" --start-ledger "${from}" \
    --id "${vault}" --output json \
    --topic "$(scval "{\"symbol\":\"${a}\"}"),$(scval "{\"symbol\":\"${b}\"}")"
}

explorer() { echo "https://stellar.expert/explorer/testnet/${1}/${2}"; }

# Send USDC from --funder until a wallet holds at least what a step needs.
top_up_to() {
  local label="$1" who="$2" target="$3" have need out hash
  have=$(balance "$(addr "pay-${who}")")
  need=$(( target - ${have:-0} ))
  if (( need <= 0 )); then
    say "${label}" "not needed, holds ${have}"
    return 0
  fi
  if (( DRY_RUN )); then
    say "${label}" "dry run: would send ${need} base units"
    return 0
  fi
  if ! out=$(stellar tx new payment --source "${FUNDER}" \
      --destination "$(addr "pay-${who}")" --asset "${USDC_ASSET}" \
      --amount "${need}" --network "${NETWORK}" 2>&1); then
    echo "FAIL: ${label}" >&2
    echo "${out}" >&2
    return 1
  fi
  hash=$(grep -oE 'Signing transaction: [0-9a-f]{64}' <<<"${out}" | awk '{print $3}')
  log_tx "${label}" "${hash:-submitted}"
}

# ── Steps ──────────────────────────────────────────────────────────────────

setup() {
  mkdir -p "${DIR}"
  echo "Accounts" >&2
  local who
  for who in "${STAKERS[@]}" anyone; do
    if ! stellar keys address "pay-${who}" >/dev/null 2>&1; then
      stellar keys generate "pay-${who}" --network "${NETWORK}" --fund >/dev/null 2>&1
      say "pay-${who}" "created and funded by Friendbot"
    fi
    printf '  %-12s %s\n' "pay-${who}" "$(addr "pay-${who}")" >&2
  done

  echo "USDC trustlines and 5 USDC each from ${FUNDER}" >&2
  for who in "${STAKERS[@]}"; do
    if [[ -z "$(balance "$(addr "pay-${who}")")" ]]; then
      stellar tx new change-trust --source "pay-${who}" --line "${USDC_ASSET}" \
        --network "${NETWORK}" >/dev/null 2>&1
      say "pay-${who}" "USDC trustline added"
    fi
    top_up_to "setup: pay-${who} holds 5 USDC" "${who}" "${STAKE}"
  done
  for who in "${STAKERS[@]}"; do
    expect "pay-${who} USDC balance" "$(balance "$(addr "pay-${who}")")" "${STAKE}"
  done
}

status() {
  need_project
  local vault state creator goal raised id
  vault=$(vault_of "${PROJECT_ID}")
  state=$(read_ "${vault}" get_state)
  creator=$(info_field "${vault}" creator)
  goal=$(info_field "${vault}" goal)
  raised=$(info_field "${vault}" raised_amount)
  echo "Project #${PROJECT_ID}" >&2
  say "vault" "${vault}"
  say "explorer" "$(explorer contract "${vault}")"
  say "state (0 raising, 1 funded, 2 active, 3 failed, 4 refunding, 5 completed)" "${state}"
  say "builder" "${creator}"
  say "raised / goal (base units)" "${raised} / ${goal}"
  say "bond posted / returned" "$(info_field "${vault}" bond_amount) / $(info_field "${vault}" bond_returned)"
  say "stakers" "$(read_ "${vault}" contributor_count)"
  for id in $(stage_ids "${vault}"); do
    say "stage ${id}: vote (approved weight, needed, open)" "$(read_ "${vault}" get_milestone_vote --milestone_id "${id}")"
    say "stage ${id}: wallets (approved, needed)" "$(read_ "${vault}" get_milestone_wallets --milestone_id "${id}")"
    say "stage ${id}: money (approvers hold, needed)" "$(read_ "${vault}" get_milestone_stake --milestone_id "${id}")"
  done
  say "next stage to pay" "$(next_stage "${vault}")"
  say "builder's record on the registry (completed, forfeited, unfunded)" \
    "$(read_ "${ATTESTATION}" get_builder_summary --builder "${creator}")"
  if [[ "$(read_ "${ATTESTATION}" has_record --vault "${vault}")" == "true" ]]; then
    say "this vault's record" "$(read_ "${ATTESTATION}" get_record --vault "${vault}")"
  fi
}

stake() {
  need_project
  local vault state goal raised who
  vault=$(vault_of "${PROJECT_ID}")
  state=$(read_ "${vault}" get_state)
  goal=$(info_field "${vault}" goal)
  raised=$(info_field "${vault}" raised_amount)
  echo "Project #${PROJECT_ID}: vault ${vault}, ${raised} of ${goal} raised" >&2
  expect "the raise is open" "${state}" "${STATE_RAISING}"
  if (( goal - raised < 3 * STAKE )); then
    echo "Only $(( goal - raised )) base units are left to raise; three 5 USDC stakes need $(( 3 * STAKE ))." >&2
    exit 1
  fi
  if ! (( DRY_RUN )); then
    save PROJECT_ID "${PROJECT_ID}"
    save VAULT "${vault}"
    save STAKE_LEDGER "$(latest_ledger)"
  fi

  for who in "${STAKERS[@]}"; do
    call "stake: pay-${who} stakes 5 USDC on #${PROJECT_ID}" "pay-${who}" "${vault}" contribute \
      --contributor "$(addr "pay-${who}")" --amount "${STAKE}" >/dev/null
  done
  (( DRY_RUN )) && { echo "Dry run: nothing was sent." >&2; return 0; }

  raised=$(info_field "${vault}" raised_amount)
  say "raised now" "${raised} of ${goal}"
  if (( raised >= goal )); then
    expect "goal reached, raise closed" "$(read_ "${vault}" get_state)" "${STATE_FUNDED}"
    echo "Next: the builder opens the stage vote in the app (Ask stakeholders for this payout)." >&2
  else
    echo "The goal is not reached yet: $(( goal - raised )) base units short. Stake the rest, then rerun approve once the vote is open." >&2
  fi
}

approve() {
  need_project
  load_state
  local vault state id who vote wallets money approved needed
  vault=$(vault_of "${PROJECT_ID}")
  state=$(read_ "${vault}" get_state)
  if [[ "${state}" != "${STATE_FUNDED}" && "${state}" != "${STATE_ACTIVE}" ]]; then
    echo "The vault reads state ${state}; approvals need a funded vault (1 or 2)." >&2
    exit 1
  fi
  id="${MILESTONE:-$(next_stage "${vault}")}"
  [[ -n "${id}" ]] || { echo "No stage left to pay." >&2; exit 1; }
  vote=$(read_ "${vault}" get_milestone_vote --milestone_id "${id}")
  if [[ "${vote}" != *true* ]]; then
    echo "Stage ${id}'s vote is not open (${vote}). The builder opens it in the app first." >&2
    exit 1
  fi
  echo "Project #${PROJECT_ID}: approving stage ${id} from three wallets" >&2
  if ! (( DRY_RUN )); then
    save APPROVE_LEDGER "$(latest_ledger)"
    save MILESTONE_ID "${id}"
  fi

  for who in "${STAKERS[@]}"; do
    call "approve: pay-${who} votes yes on stage ${id} of #${PROJECT_ID}" "pay-${who}" "${vault}" \
      approve_milestone --contributor "$(addr "pay-${who}")" --milestone_id "${id}" >/dev/null
  done
  (( DRY_RUN )) && { echo "Dry run: nothing was sent." >&2; return 0; }

  vote=$(read_ "${vault}" get_milestone_vote --milestone_id "${id}")
  wallets=$(read_ "${vault}" get_milestone_wallets --milestone_id "${id}")
  money=$(read_ "${vault}" get_milestone_stake --milestone_id "${id}")
  say "weight (approved, needed, open)" "${vote}"
  say "wallets (approved, needed)" "${wallets}"
  say "money (approvers hold, needed)" "${money}"
  approved=$(cut -d, -f1 <<<"${vote#[}")
  needed=$(cut -d, -f2 <<<"${vote#[}")
  if (( approved >= needed )) && accepts "${vault}" release_milestone --milestone_id "${id}"; then
    say "check: the vault accepts a release of stage ${id}" "yes"
    echo "Carried. The governance keeper sends release_milestone within its interval (15 minutes). Run: scripts/payout-run.sh watch ${PROJECT_ID}" >&2
  else
    echo "FAIL: the vault does not accept a release yet. Read the three conditions above." >&2
    exit 1
  fi
}

watch() {
  need_project
  load_state
  local vault id from state n released creator
  vault=$(vault_of "${PROJECT_ID}")
  id="${MILESTONE:-${MILESTONE_ID:-$(next_stage "${vault}")}}"
  from="${APPROVE_LEDGER:-$(latest_ledger)}"
  echo "Project #${PROJECT_ID}: waiting for stage ${id} to be paid (polling every 30 s, up to 40 minutes)" >&2
  n=0
  while :; do
    state=$(read_ "${vault}" get_state)
    released=$(read_ "${vault}" get_info | grep -oE '\{[^{}]*\}' | grep -E "[{,]id:${id}([,}])" | grep -oE 'released:(true|false)' | cut -d: -f2 || true)
    printf '  %s state=%s stage %s released=%s\n' "$(date -u +%T)" "${state}" "${id}" "${released}" >&2
    [[ "${released}" == "true" ]] && break
    n=$(( n + 1 ))
    if (( n >= 80 )); then
      echo "Not paid after 40 minutes. Check keeper-dry-run; the fallback is: scripts/payout-run.sh release ${PROJECT_ID}" >&2
      exit 1
    fi
    sleep 30
  done

  echo "Paid. The release, from the vault's events:" >&2
  vault_events "${vault}" "${from}" MILESTN RELEASE | grep -oE '"txHash":"[0-9a-f]{64}"|"ledger":[0-9]+' | paste - - >&2 || true
  creator=$(info_field "${vault}" creator)
  state=$(read_ "${vault}" get_state)
  say "state" "${state}"
  if [[ "${state}" == "${STATE_COMPLETED}" ]]; then
    expect "vault fully drained (payout + bond back)" "$(balance "${vault}")" "0"
    expect "bond returned" "$(info_field "${vault}" bond_returned)" "true"
    say "record" "$(read_ "${ATTESTATION}" get_record --vault "${vault}")"
    expect "record outcome is Completed" \
      "$(read_ "${ATTESTATION}" get_record --vault "${vault}" | grep -oE 'outcome:[0-9]+' | cut -d: -f2)" "${OUTCOME_COMPLETED}"
    say "builder summary (completed, forfeited, unfunded)" \
      "$(read_ "${ATTESTATION}" get_builder_summary --builder "${creator}")"
    echo "Attestation event, filtered by builder:" >&2
    stellar events --network "${NETWORK}" --start-ledger "${from}" --id "${ATTESTATION}" --output json \
      --topic "$(scval '{"symbol":"ATTEST"}'),$(scval '{"symbol":"RECORDED"}'),$(scval "{\"address\":\"${creator}\"}")" >&2 || true
  else
    echo "Stage ${id} is paid; later stages remain, so the vault is not completed yet." >&2
  fi
}

release() {
  need_project
  load_state
  local vault id
  vault=$(vault_of "${PROJECT_ID}")
  id="${MILESTONE:-${MILESTONE_ID:-$(next_stage "${vault}")}}"
  echo "Fallback: sending release_milestone for stage ${id} of #${PROJECT_ID} from pay-anyone" >&2
  call "release: stage ${id} of #${PROJECT_ID} paid by an unrelated account (keeper fallback)" \
    pay-anyone "${vault}" release_milestone --milestone_id "${id}" >/dev/null
}

keeper_dry_run() {
  local secret
  [[ -f "${ENV_FILE}" ]] || { echo "No ${ENV_FILE}; pass --env-file <path to .env.local>." >&2; exit 1; }
  secret=$(grep -E '^INDEXER_SECRET=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  [[ -n "${secret}" ]] || { echo "INDEXER_SECRET is not in ${ENV_FILE}." >&2; exit 1; }
  echo "Governance keeper dry run on ${APP_URL} (sends nothing):" >&2
  curl -s --max-time 300 -X POST "${APP_URL}/api/governance-keeper" \
    -H "Authorization: Bearer ${secret}" -H "Content-Type: application/json" \
    -d '{"dryRun": true}'
  echo
}

case "${STEP}" in
  setup)          setup ;;
  status)         status ;;
  stake)          stake ;;
  approve)        approve ;;
  watch)          watch ;;
  release)        release ;;
  keeper-dry-run) keeper_dry_run ;;
  *) sed -n '2,39p' "$0"; exit 1 ;;
esac
