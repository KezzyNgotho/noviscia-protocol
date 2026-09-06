use std::process::Command;

/// Compile BOTH wire contracts:
///
/// * `grpc-pipeline/proto/noviscia.proto` — the SHARED production pipeline
///   schema (noviscia.pipeline). Reused verbatim so a sandbox client cannot
///   tell the stream from the real one.
/// * `proto/noviscia_sandbox.proto` — the spec-conformant headless-API
///   contract (noviscia.sandbox.v1, `MarketVelocityStream`).
fn main() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");

    let shared = format!("{}/../grpc-pipeline/proto/noviscia.proto", manifest_dir);
    tonic_build::compile_protos(&shared).expect("compile shared noviscia.proto");
    println!("cargo:rerun-if-changed={}", shared);

    let spec = format!("{}/proto/noviscia_sandbox.proto", manifest_dir);
    tonic_build::compile_protos(&spec).expect("compile sandbox spec noviscia_sandbox.proto");
    println!("cargo:rerun-if-changed={}", spec);

    let _ = Command::new("true");
}
