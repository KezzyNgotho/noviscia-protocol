use std::process::Command;

/// Compile the shared pipeline contract. Kept in grpc-pipeline so the sandbox
/// reuses the EXACT wire schema the real production pipeline serves — a
/// sandbox client cannot tell the difference.
fn main() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let proto = format!("{}/../grpc-pipeline/proto/noviscia.proto", manifest_dir);
    tonic_build::compile_protos(&proto).expect("compile shared noviscia.proto");

    // Re-run if the shared schema moves.
    println!("cargo:rerun-if-changed={}", proto);
    let _ = Command::new("true");
}