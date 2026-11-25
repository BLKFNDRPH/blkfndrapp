#!/usr/bin/env bash
#
# Run the CI workflow on this machine instead of on GitHub Actions.
#
# The same steps as .github/workflows/ci.yml, in the same order, with the same
# environment. Where CI uploads an artifact, this writes it to ci-local/
# instead: the SBOM, the wasm build hashes, and a log per step.
#
# CI runs on a fresh checkout, so this does too. It copies the files git would
# commit (tracked files plus new ones .gitignore does not exclude, so
# uncommitted edits are included) into a clean folder outside the repository
# and runs every step there. Running in the working folder instead picks up
# what a checkout never has: a stale .next build cache, .env.local, and the
# old session worktrees under .claude/, which eslint would lint.
#
# Unlike CI, a failing step does not stop the run: every step runs, and the
# summary at the end lists what failed. The exit code is non-zero if any did.
#
#   bash scripts/ci-local.sh                  both jobs
#   bash scripts/ci-local.sh web              the web app job only
#   bash scripts/ci-local.sh contracts        the contracts job only
#   SKIP_INSTALL=1 bash scripts/ci-local.sh   reuse the clean folder's
#                                             node_modules (skips npm ci)
#   CI_LOCAL_DIR=/path bash scripts/ci-local.sh   where the clean folder goes
#
# The clean folder keeps its Rust target/ between runs, as CI's rust-cache
# does, so only the first contracts run compiles from scratch.
#
# Needs Node 24 and the Rust toolchain in rust-toolchain.toml (1.81.0, with
# the wasm32-unknown-unknown target and clippy), as CI installs them.
#
# Keep this in step with ci.yml: a step added there belongs here too.

set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO}"

OUT="${REPO}/ci-local"
CHECKOUT="${CI_LOCAL_DIR:-${TMPDIR:-/tmp}/blkfndr-ci-local}"
JOBS="${*:-web contracts}"
failed=0

for job in ${JOBS}; do
  case "${job}" in
    web | contracts) ;;
    *) echo "Unknown job '${job}': use web or contracts"; exit 2 ;;
  esac
done

rm -rf "${OUT}"
mkdir -p "${OUT}/logs"
: > "${OUT}/results.tsv"

# A fresh copy of what git would commit. Everything from the last run goes
# except target/ (the Rust cache) and node_modules/ (npm ci replaces it anyway,
# and SKIP_INSTALL reuses it).
prepare_checkout() {
  case "${CHECKOUT}" in
    "" | / | "${REPO}" | "${REPO}"/*)
      echo "Refusing to use ${CHECKOUT:-an empty path} as the clean folder"
      exit 2 ;;
  esac
  mkdir -p "${CHECKOUT}"
  find "${CHECKOUT}" -mindepth 1 -maxdepth 1 ! -name target ! -name node_modules \
    -exec rm -rf {} +
  # Tracked and new unignored files, less any deleted in the working tree.
  git ls-files -z --cached --others --exclude-standard \
    | while IFS= read -r -d '' f; do [ -e "${f}" ] && printf '%s\0' "${f}"; done \
    | tar --null -T - -cf - \
    | tar -xf - -C "${CHECKOUT}"
}

step() {
  local job=$1 name=$2
  shift 2
  local log="${OUT}/logs/${job}-$(echo "${name}" | tr 'A-Z ' 'a-z-').log"
  local start=$SECONDS
  printf '%-10s %-32s ' "${job}" "${name}"
  if (cd "${CHECKOUT}" && "$@") > "${log}" 2>&1; then
    printf 'pass  %4ss\n' $((SECONDS - start))
    printf '%s\t%s\tpass\t%s\n' "${job}" "${name}" $((SECONDS - start)) >> "${OUT}/results.tsv"
  else
    printf 'FAIL  %4ss  see %s\n' $((SECONDS - start)) "${log#"${REPO}"/}"
    printf '%s\t%s\tFAIL\t%s\n' "${job}" "${name}" $((SECONDS - start)) >> "${OUT}/results.tsv"
    failed=$((failed + 1))
  fi
}

check_versions() {
  echo "node $(node --version)"
  local major
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "${major}" = 24 ] || { echo "CI runs Node 24; this is Node ${major}"; return 1; }
}

production_build() {
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=stub \
  NEXT_PUBLIC_APP_URL=http://localhost:9002 \
  NEXT_TELEMETRY_DISABLED=1 \
    npm run build
}

audit() {
  npm audit --omit=dev || true
  npm run audit:gate
}

sbom() {
  npm sbom --sbom-format cyclonedx > "${OUT}/sbom.cdx.json"
}

check_toolchain() {
  cargo --version
  local want
  want=$(grep -E '^channel' rust-toolchain.toml | sed -E 's/.*"(.*)".*/\1/')
  cargo --version | grep -q " ${want} " || { echo "CI runs Rust ${want}"; return 1; }
  rustup target list --installed | grep -q wasm32-unknown-unknown
}

build_hashes() {
  {
    echo "## Contract build hashes"
    echo
    echo '| Contract | Bytes | sha256 |'
    echo '|---|---:|---|'
    for wasm in target/wasm32-unknown-unknown/release/*.wasm; do
      name=$(basename "$wasm" .wasm)
      size=$(wc -c < "$wasm" | tr -d ' ')
      hash=$(sha256sum "$wasm" | cut -d' ' -f1)
      echo "| \`$name\` | $size | \`$hash\` |"
    done
  } > "${OUT}/contract-hashes.md"
  cat "${OUT}/contract-hashes.md"
}

run_web() {
  step web "Node version" check_versions
  if [ -z "${SKIP_INSTALL:-}" ] || [ ! -d "${CHECKOUT}/node_modules" ]; then
    step web "npm ci" npm ci
  fi
  step web "Typecheck" npm run typecheck
  step web "Lint" npm run lint
  step web "Test" npm test
  step web "Authorization check" npm run test:authz
  step web "Route behaviour check" npm run test:routes
  step web "Production build" production_build
  step web "Header delivery check" npm run test:headers
  step web "Database policy check" npm run test:db
  step web "Audit production deps" audit
  step web "SBOM" sbom
}

run_contracts() {
  step contracts "Rust toolchain" check_toolchain
  step contracts "Build wasm artifacts" bash scripts/build-contracts.sh
  step contracts "Clippy" cargo clippy --workspace --all-targets -- -D warnings
  step contracts "Test" cargo test --workspace
  step contracts "Record build hashes" build_hashes
}

echo "Local CI on $(git rev-parse --abbrev-ref HEAD) at $(git rev-parse --short HEAD)"
[ -z "$(git status --porcelain)" ] \
  || echo "Includes uncommitted changes; GitHub CI would see only what is pushed."
echo "Clean folder: ${CHECKOUT}"
prepare_checkout
echo

for job in ${JOBS}; do
  case "${job}" in
    web) run_web ;;
    contracts) run_contracts ;;
  esac
done

echo
if [ "${failed}" -eq 0 ]; then
  echo "All steps passed. Logs and artifacts in ci-local/."
else
  echo "${failed} step(s) failed. Logs in ci-local/logs/."
fi
exit $(( failed > 0 ))
