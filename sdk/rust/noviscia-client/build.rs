use std::process::Command;

/// Compile the shared `noviscia.sandbox.v1` wire contract (the Yellowstone-mock
/// market-velocity feed). The contract is mirrored verbatim from
/// `services/sandbox-hub/proto/` so an integrator of `noviscia-client` talks
/// the same bytes against the sandbox (`:10000`) or the production pipeline.
fn main() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");

    let spec = format!("{}/proto/noviscia_sandbox.proto", manifest_dir);
    tonic_build::compile_protos(&spec).expect("compile sandbox spec noviscia_sandbox.proto");
    println!("cargo:rerun-if-changed={}", spec);

    let _ = Command::new("true");
}