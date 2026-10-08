#!/usr/bin/env bash
#
# Deploy the BLKFNDR contract set.
#
# Every contract configures itself in its constructor, which runs inside its
# deploy transaction — there is no deployed-but-unconfigured window for anyone
# to seize (audit H-03). That makes deploy ORDER the thing to get right:
#
#   * the factory takes the identity and attestation registry addresses in its
#     constructor, so both must be deployed before it, and
#   * the attestation registry no longer takes the factory at construction —
#     that is what breaks the old factory<->attestation cycle. It is deployed
#     first and told to trust the factory with a single post-deploy add_factory,
#     the one wiring step that cannot be folded into a constructor.
#
# The vault is not deployed here. It is uploaded as wasm and the factory
# instantiates one per project from that hash; each vault is configured
# atomically inside create_vault, so it has no such window either.
#
# Optional, for a full platform set rather than a bare one:
#
#   * --attestors and --roster-admins seed the identity registry's attestors
#     and the admin roster, both signed by the source (their admin and owner);
#   * --shareholders or --shareholders-from deploy a treasury against the new
#     factory and make it the fee wallet. The treasury takes the factory in its
#     constructor, so it comes after it: the factory is deployed with an interim
#     fee wallet, then repointed with update_fee_wallet.
#
# Usage:
#   scripts/deploy-contracts.sh --network testnet --source my-key
#
# Replacing the live set (as on 2026-10-06; see docs/smart-contracts.md, "The registry redeploy"):
#   scripts/deploy-contracts.sh --network testnet --source ba-escrow-deployer \
#     --first-project-id <live get_project_count + 1> \
#     --shareholders-from <live treasury> \
#     --roster-admins <G…,G…> --attestors <G…,G…>
#
# Requires the Stellar CLI and a funded, configured source account.

set -euo pipefail

cd "$(dirname "$0")/.."

NETWORK="testnet"
SOURCE=""
FEE_WALLET=""
PLATFORM_FEE="10000000"       # 1 unit at 7 decimals, of the project's own token
MIN_CONTRIBUTION="50000000"   # 5 units — the SOW entry point
VOTING_WINDOW="604800"        # 7 days in seconds
FIRST_PROJECT_ID="1"          # a replacement factory continues its predecessor's ids
ATTESTORS=""                  # comma-separated G… addresses
ROSTER_ADMINS=""              # comma-separated G… addresses, besides the owner
SHAREHOLDERS=""               # JSON: [{"address":"G…","share_bps":N},…], totalling 10000
SHAREHOLDERS_FROM=""          # a treasury to copy the shareholders from
OUT_FILE="deployed-contracts.env"

usage() {
  cat <<USAGE
Deploy the BLKFNDR contract set.

  --network <name>          Stellar network (default: testnet)
  --source <account>        Stellar CLI identity to deploy from (required)
  --fee-wallet <address>    Destination for platform fees (default: source address).
                            With a treasury, only the interim wallet before it is repointed.
  --platform-fee <stroops>  Flat per-project fee (default: ${PLATFORM_FEE})
  --min-contribution <n>    Minimum contribution in stroops (default: ${MIN_CONTRIBUTION})
  --voting-window <secs>    Milestone voting window (default: ${VOTING_WINDOW})
  --first-project-id <n>    Id of the first project this factory creates (default: ${FIRST_PROJECT_ID}).
                            When replacing a factory, pass its get_project_count + 1:
                            the app keys projects by id, so ids must not repeat.
  --attestors <G…,G…>       Accounts to make KYC attestors in the identity registry
  --roster-admins <G…,G…>   Accounts to add to the admin roster (the source is its owner)
  --shareholders <json>     Deploy a treasury with this register and make it the fee wallet
  --shareholders-from <C…>  The same, copying the register from an existing treasury
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
    --first-project-id) FIRST_PROJECT_ID="$2"; shift 2 ;;
    --attestors)        ATTESTORS="$2"; shift 2 ;;
    --roster-admins)    ROSTER_ADMINS="$2"; shift 2 ;;
    --shareholders)     SHAREHOLDERS="$2"; shift 2 ;;
    --shareholders-from) SHAREHOLDERS_FROM="$2"; shift 2 ;;
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

if [[ -n "${SHAREHOLDERS}" && -n "${SHAREHOLDERS_FROM}" ]]; then
  echo "error: pass --shareholders or --shareholders-from, not both" >&2
  exit 1
fi
if [[ -n "${SHAREHOLDERS_FROM}" ]]; then
  SHAREHOLDERS=$(stellar contract invoke --id "${SHAREHOLDERS_FROM}" --source "${SOURCE}" \
    --network "${NETWORK}" --send=no -- get_shareholders 2>/dev/null || true)
  if [[ "${SHAREHOLDERS}" != \[* ]]; then
    echo "error: could not read the shareholders of ${SHAREHOLDERS_FROM}" >&2
    exit 1
  fi
fi

# A comma-separated list, spaces removed, as one argument per line.
list() { tr -d ' ' <<<"$1" | tr ',' '\n' | grep -v '^$' || true; }

echo "network      ${NETWORK}"
echo "admin        ${ADMIN}"
echo "fee wallet   ${FEE_WALLET}${SHAREHOLDERS:+ (interim; the treasury replaces it)}"
echo "platform fee ${PLATFORM_FEE} stroops (flat, per project, paid by the builder)"
echo "first project id ${FIRST_PROJECT_ID}"
[[ -n "${SHAREHOLDERS}" ]] && echo "shareholders ${SHAREHOLDERS}"
echo

# ── Build ──────────────────────────────────────────────────────────────────

echo "Building contracts..."
bash scripts/build-contracts.sh >/dev/null
OUT=target/wasm32-unknown-unknown/release
echo "  done"
echo

deploy() {
  local wasm="$1"; shift
  stellar contract deploy \
    --wasm "${OUT}/${wasm}.wasm" \
    --source "${SOURCE}" \
    --network "${NETWORK}" \
    -- "$@" 2>/dev/null | tail -1
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

# ── Deploy — each contract configured atomically by its constructor ─────────
#
# Order matters: identity and attestation must exist before the factory, which
# takes their addresses in its constructor. The attestation registry is
# deployed first and takes no factory (the cycle-breaker); the factory is
# deployed last, with both registry addresses.

echo
echo "Deploying contracts (configured at deploy via constructors)..."

IDENTITY_ID=$(deploy blkfndr_identity --admin "${ADMIN}")
echo "  identity    ${IDENTITY_ID}"
for account in $(list "${ATTESTORS}"); do
  invoke "${IDENTITY_ID}" add_attestor --account "${account}"
  echo "    attestor  ${account}"
done

ADMIN_ID=$(deploy blkfndr_admin --owner "${ADMIN}")
echo "  admin       ${ADMIN_ID}"
for account in $(list "${ROSTER_ADMINS}"); do
  # The owner is an admin from construction; adding it again is refused.
  [[ "${account}" == "${ADMIN}" ]] && continue
  invoke "${ADMIN_ID}" add_admin --account "${account}"
  echo "    admin     ${account}"
done

ATTESTATION_ID=$(deploy blkfndr_attestation --admin "${ADMIN}")
echo "  attestation ${ATTESTATION_ID}"

FACTORY_ID=$(deploy blkfndr_factory \
  --admin "${ADMIN}" \
  --vault_wasm_hash "${VAULT_WASM_HASH}" \
  --fee_wallet "${FEE_WALLET}" \
  --platform_fee "${PLATFORM_FEE}" \
  --identity_registry "${IDENTITY_ID}" \
  --attestation_registry "${ATTESTATION_ID}" \
  --voting_window_secs "${VOTING_WINDOW}" \
  --min_contribution "${MIN_CONTRIBUTION}" \
  --first_project_id "${FIRST_PROJECT_ID}")
echo "  factory     ${FACTORY_ID}"

# ── Wire the one edge a constructor cannot: attestation trusts the factory ──
#
# The factory did not exist when the attestation registry was deployed, so this
# is the single post-deploy step. It is admin-gated (add_factory calls
# admin.require_auth), so it is not itself a front-runnable window.

echo
echo "Granting the factory attestation-write trust..."
invoke "${ATTESTATION_ID}" add_factory --factory "${FACTORY_ID}"
echo "  attestation registry now trusts the factory"

# ── Treasury: built against the factory, then made its fee wallet ──────────
#
# The treasury takes the factory in its constructor and it cannot be changed
# afterwards, so it comes last. Until update_fee_wallet the factory pays fees
# to the interim wallet; it has created no vaults yet, so none are paid there.

TREASURY_ID=""
if [[ -n "${SHAREHOLDERS}" ]]; then
  echo
  echo "Deploying the treasury and making it the fee wallet..."
  TREASURY_ID=$(deploy blkfndr_treasury \
    --deployer "${ADMIN}" \
    --factory "${FACTORY_ID}" \
    --shareholders "${SHAREHOLDERS}")
  echo "  treasury    ${TREASURY_ID}"
  invoke "${FACTORY_ID}" update_fee_wallet --new_fee_wallet "${TREASURY_ID}"
  echo "  factory fee wallet repointed to the treasury"
fi

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
  local id="$1"; shift
  stellar contract invoke --id "${id}" --source "${SOURCE}" --network "${NETWORK}" \
    --send=no -- "$@" 2>/dev/null | tr -d '"'
}

FAILED=0
check "factory knows the attestation registry" \
  "$(read_back "${FACTORY_ID}" get_attestation_registry)" "${ATTESTATION_ID}" || FAILED=1
check "factory knows the identity registry" \
  "$(read_back "${FACTORY_ID}" get_identity_registry)" "${IDENTITY_ID}" || FAILED=1
check "attestation registry trusts the factory" \
  "$(stellar contract invoke --id "${ATTESTATION_ID}" --source "${SOURCE}" \
      --network "${NETWORK}" -- is_factory_trusted \
      --factory "${FACTORY_ID}" 2>/dev/null | tr -d '"')" "true" || FAILED=1
check "factory admin is the deployer" \
  "$(read_back "${FACTORY_ID}" get_admin)" "${ADMIN}" || FAILED=1
check "factory charges the platform fee" \
  "$(read_back "${FACTORY_ID}" get_platform_fee)" "${PLATFORM_FEE}" || FAILED=1
check "factory's next project id is ${FIRST_PROJECT_ID}" \
  "$(read_back "${FACTORY_ID}" get_project_count)" "$(( FIRST_PROJECT_ID - 1 ))" || FAILED=1
check "factory pays fees to the $([[ -n "${TREASURY_ID}" ]] && echo treasury || echo fee wallet)" \
  "$(read_back "${FACTORY_ID}" get_fee_wallet)" "${TREASURY_ID:-${FEE_WALLET}}" || FAILED=1
if [[ -n "${TREASURY_ID}" ]]; then
  check "treasury governs the factory" \
    "$(read_back "${TREASURY_ID}" get_factory)" "${FACTORY_ID}" || FAILED=1
  check "treasury has the shareholders" \
    "$(read_back "${TREASURY_ID}" get_shareholders | tr -d ' ')" \
    "$(tr -d ' "' <<<"${SHAREHOLDERS}")" || FAILED=1
fi
for account in $(list "${ATTESTORS}"); do
  check "attestor ${account}" \
    "$(read_back "${IDENTITY_ID}" is_attestor --account "${account}")" "true" || FAILED=1
done
for account in $(list "${ROSTER_ADMINS}"); do
  check "roster admin ${account}" \
    "$(read_back "${ADMIN_ID}" is_admin --account "${account}")" "true" || FAILED=1
done

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
  echo "# Treasury, when one was deployed. Not an app variable: the app reads the"
  echo "# treasury from the factory's fee wallet."
  echo "BLKFNDR_TREASURY_CONTRACT_ID=${TREASURY_ID}"
  echo
  echo "# Vault wasm hash — the factory instantiates one vault per project"
  echo "# from this. Reviewers check a deployed vault against it."
  echo "BLKFNDR_VAULT_WASM_HASH=${VAULT_WASM_HASH}"
} > "${OUT_FILE}"

echo
echo "Wiring verified. Contract IDs written to ${OUT_FILE}."
echo
echo "Build hashes for the evidence package:"
for c in blkfndr_vault blkfndr_factory blkfndr_attestation blkfndr_identity blkfndr_admin \
  ${TREASURY_ID:+blkfndr_treasury}; do
  if [[ -f "${OUT}/${c}.wasm" ]]; then
    printf '  %-22s sha256:%s\n' "${c}" "$(sha256sum "${OUT}/${c}.wasm" | cut -d' ' -f1)"
  fi
done

echo
echo "Next: copy the IDs from ${OUT_FILE} into .env.local, and register the"
echo "token contracts the platform accepts before creating any project."
