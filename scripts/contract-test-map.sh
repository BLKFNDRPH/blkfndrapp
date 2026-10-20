#!/bin/bash
# Contract test map: the fallback measurement when cargo-llvm-cov cannot be
# installed (it needs the llvm-tools-preview component, which is not available
# for every toolchain). For each contract crate it prints how many #[test]
# functions the crate has and, for every public entrypoint in lib.rs, how many
# times the test module calls it directly (client.name(...)) and through the
# refusal path (client.try_name(...)). An entrypoint with 0 and 0 has no test
# calling it. The constructor is invoked through register(), so __constructor
# always shows 0 here even though every suite registers the contract.
#
#   bash scripts/contract-test-map.sh            every crate
#   bash scripts/contract-test-map.sh blkfndr-vault
#
# This counts call sites, not executed lines. For line coverage install
# cargo-llvm-cov and run `cargo llvm-cov --workspace --summary-only` from
# contracts/ (see docs/contributing.md, Coverage).

set -euo pipefail
cd "$(dirname "$0")/../contracts"

crates="$*"
if [ -z "$crates" ]; then
  crates=$(ls -d blkfndr-*/ | tr -d /)
fi

for crate in $crates; do
  tests=$(cat "$crate"/src/*.rs | grep -cF "#[test]" || true)
  echo "== $crate: $tests #[test] functions"
  for name in $(grep -E "^ *pub fn [a-z_0-9]+" "$crate/src/lib.rs" | sed -E 's/^ *pub fn ([a-z_0-9]+).*/\1/'); do
    direct=$(grep -cE "[.]$name[(]" "$crate/src/test.rs" || true)
    try=$(grep -cE "[.]try_$name[(]" "$crate/src/test.rs" || true)
    flag=""
    if [ "$direct" = 0 ] && [ "$try" = 0 ] && [ "$name" != "__constructor" ]; then
      flag="  <- no test calls this"
    fi
    printf "   %-28s direct %3s  try_ %3s%s\n" "$name" "$direct" "$try" "$flag"
  done
done
