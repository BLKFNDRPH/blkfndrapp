#!/usr/bin/env bash
#
# Build the Soroban contracts in the pinned container (Dockerfile.contracts)
# and write their sha256 hashes, so two machines can show they produce the
# same wasm. CI records the hashes from this build; docs/reproducible-build.md
# explains how to check them on a second machine and against the chain.
#
#   bash scripts/reproducible-build.sh
#       build, then write to target/reproducible/:
#         wasm-hashes.txt   "sha256  contract.wasm", one per contract, sorted
#         build-info.txt    commit, base image digest, toolchain, host
#         wasm/*.wasm       the built contracts
#   bash scripts/reproducible-build.sh --out DIR
#       write those to DIR instead
#   bash scripts/reproducible-build.sh --compare OTHER.txt
#       build, then compare with another machine's wasm-hashes.txt; exits 1
#       if any contract differs
#   bash scripts/reproducible-build.sh --compare OTHER.txt --no-build
#       compare OTHER.txt with the wasm-hashes.txt already in the out folder
#
# The repository is mounted read-only. Inside the container the files git
# would commit under Cargo.toml, Cargo.lock, rust-toolchain.toml, .cargo/,
# contracts/ and scripts/build-contracts.sh are copied to /build, line endings
# are normalised to LF (a Windows checkout has CRLF), and
# scripts/build-contracts.sh runs there: the same build the host does, with
# --locked, at a fixed path. Uncommitted edits are included, and build-info.txt
# says so: hashes from a dirty tree are not comparable with anyone else's.
#
# Environment:
#   REPRO_PLATFORM    docker platform (default linux/amd64, on every host)
#   REPRO_IMAGE       local image tag (default blkfndr-contracts-build)
#   SOURCE_DATE_EPOCH defaults to the HEAD commit time
#   REPRO_COMMIT      commit to record when there is no .git (ci-local.sh's
#                     clean folder has none)

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO}"

OUT="${REPO}/target/reproducible"
COMPARE=""
BUILD=1
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --compare) COMPARE="$2"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    -h | --help) sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument '$1' (see --help)" >&2; exit 2 ;;
  esac
done
case "${OUT}" in /* | [A-Za-z]:*) ;; *) OUT="${REPO}/${OUT}" ;; esac

# Hash lines only: no comments or blank lines, LF endings, sorted by file name.
normalise() {
  tr -d '\r' < "$1" | grep -Ev '^[[:space:]]*(#|$)' | awk '{print $1"  "$2}' | sort -k2
}

compare() {
  local mine="${OUT}/wasm-hashes.txt" theirs="$1"
  [ -f "${mine}" ] || { echo "No ${mine}; build first" >&2; return 2; }
  [ -f "${theirs}" ] || { echo "No such file: ${theirs}" >&2; return 2; }
  echo
  echo "Comparing ${mine#"${REPO}"/}"
  echo "     with ${theirs}"
  if diff -u <(normalise "${theirs}") <(normalise "${mine}") \
       --label "other machine" --label "this machine"; then
    echo "MATCH: all $(normalise "${mine}" | wc -l | tr -d ' ') contract hashes are identical."
  else
    echo "MISMATCH: the lines above differ (- other machine, + this machine)." >&2
    return 1
  fi
}

if [ "${BUILD}" -eq 0 ]; then
  [ -n "${COMPARE}" ] || { echo "--no-build needs --compare FILE" >&2; exit 2; }
  compare "${COMPARE}"
  exit $?
fi

# Docker Desktop on Windows installs here and Git Bash does not always have it
# on PATH.
if ! command -v docker > /dev/null 2>&1 \
   && [ -x "/c/Program Files/Docker/Docker/resources/bin/docker" ]; then
  PATH="${PATH}:/c/Program Files/Docker/Docker/resources/bin"
fi
command -v docker > /dev/null 2>&1 || { echo "docker not found" >&2; exit 1; }
docker info > /dev/null 2>&1 || { echo "docker is installed but not running" >&2; exit 1; }

PLATFORM="${REPRO_PLATFORM:-linux/amd64}"
IMAGE="${REPRO_IMAGE:-blkfndr-contracts-build}"
BASE_IMAGE="$(grep -E '^FROM ' Dockerfile.contracts | head -1 | awk '{print $2}')"

# Git Bash would rewrite /src and /build in docker's arguments; docker needs
# the Windows form of the host path.
export MSYS_NO_PATHCONV=1
if command -v cygpath > /dev/null 2>&1; then
  HOST_REPO="$(cygpath -w "${REPO}")"
else
  HOST_REPO="${REPO}"
fi

SOURCES=(Cargo.toml Cargo.lock rust-toolchain.toml .cargo contracts scripts/build-contracts.sh)
if git rev-parse --git-dir > /dev/null 2>&1; then
  COMMIT="$(git rev-parse HEAD)"
  EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct)}"
  if [ -n "$(git status --porcelain -- "${SOURCES[@]}")" ]; then DIRTY=yes; else DIRTY=no; fi
  list_sources() {
    git ls-files -z --cached --others --exclude-standard -- "${SOURCES[@]}" \
      | while IFS= read -r -d '' f; do [ -e "${f}" ] && printf '%s\0' "${f}"; done
  }
else
  # A copy without .git, such as ci-local.sh's clean folder: it already holds
  # only what git would commit.
  COMMIT="${REPRO_COMMIT:-unknown}"
  EPOCH="${SOURCE_DATE_EPOCH:-0}"
  DIRTY="${REPRO_DIRTY:-unknown}"
  list_sources() {
    find "${SOURCES[@]}" -type f -not -path '*/target/*' -print0
  }
fi

echo "Building the image (${BASE_IMAGE%%@*}, ${PLATFORM})..."
docker build --platform "${PLATFORM}" -t "${IMAGE}" - < Dockerfile.contracts > /dev/null

# Inside the container. Build output goes to stderr: stdout carries only the
# tar of the results, so nothing is written to the host through a mount.
INNER='
set -euo pipefail
tar -C /src --null -T - -cf - | tar -C /build -xf -
find /build -type f \( -name "*.rs" -o -name "*.toml" -o -name "*.lock" -o -name "*.sh" \) \
  -exec sed -i "s/\r$//" {} +
{
  cd /build
  bash scripts/build-contracts.sh
  mkdir -p /out/wasm
  cp target/wasm32-unknown-unknown/release/*.wasm /out/wasm/
  (cd /out/wasm && sha256sum -- *.wasm | sort -k2) > /out/wasm-hashes.txt
  { rustc -vV; cargo -V; } > /out/toolchain.txt
} >&2
tar -C /out -cf - .
'

# Only what this script writes: --out may be a folder with other things in it
# (ci-local.sh passes ci-local/, which holds its logs).
mkdir -p "${OUT}"
rm -rf "${OUT}/wasm" "${OUT}/wasm-hashes.txt" "${OUT}/build-info.txt" "${OUT}/toolchain.txt"
echo "Building the contracts in the container (commit ${COMMIT:0:12}, dirty: ${DIRTY})..."
list_sources | docker run -i --rm \
  --platform "${PLATFORM}" \
  -v "${HOST_REPO}:/src:ro" \
  -v blkfndr-cargo-registry:/usr/local/cargo/registry \
  -e SOURCE_DATE_EPOCH="${EPOCH}" \
  "${IMAGE}" bash -c "${INNER}" \
  | tar -xf - -C "${OUT}"

{
  echo "commit:            ${COMMIT}"
  echo "uncommitted edits: ${DIRTY}"
  echo "base image:        ${BASE_IMAGE}"
  echo "platform:          ${PLATFORM}"
  echo "SOURCE_DATE_EPOCH: ${EPOCH}"
  echo "built at (UTC):    $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host:              $(uname -srm)"
  echo
  cat "${OUT}/toolchain.txt"
} > "${OUT}/build-info.txt"
rm -f "${OUT}/toolchain.txt"

echo
cat "${OUT}/build-info.txt"
echo
echo "wasm-hashes.txt (${OUT#"${REPO}"/}):"
cat "${OUT}/wasm-hashes.txt"
[ "${DIRTY}" = no ] \
  || echo "Note: built with uncommitted changes; these hashes are not comparable with another machine's."

if [ -n "${COMPARE}" ]; then
  compare "${COMPARE}"
fi
