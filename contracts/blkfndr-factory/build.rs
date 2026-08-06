use std::path::Path;

/// Testing `create_vault` means actually deploying a vault, which needs the
/// vault compiled to wasm — a separate build with a different target that
/// cargo will not do for us.
///
/// Rather than `include_bytes!` a path that may not exist (a hard compile
/// error on a clean checkout, which is how this crate's tests used to break),
/// detect the artifact and let the deployment tests compile only when it is
/// there. `scripts/build-contracts.sh` produces it; CI runs that first.
fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let wasm = Path::new(&manifest_dir)
        .join("../../target/wasm32-unknown-unknown/release/blkfndr_vault.wasm");

    println!("cargo:rerun-if-changed={}", wasm.display());
    println!("cargo:rustc-check-cfg=cfg(has_vault_wasm)");

    if wasm.exists() {
        println!("cargo:rustc-cfg=has_vault_wasm");
    } else {
        println!(
            "cargo:warning=blkfndr_vault.wasm not found — vault deployment tests \
             will be skipped. Run scripts/build-contracts.sh first to include them."
        );
    }
}
