#!/usr/bin/env bash
# Upgrade devnet noviscia_clearing — the hardened prediction-market engine
# (in-place upgrade of the legacy program at GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/new-id.json}"
export TMPDIR="${TMPDIR:-$ROOT/.cache/tmp}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.cache/cargo-target}"
mkdir -p "$TMPDIR" "$CARGO_TARGET_DIR/deploy" target/deploy

solana config set --url devnet

echo "Building noviscia_clearing (TMPDIR=$TMPDIR)..."
cargo build-sbf --manifest-path programs/cluster-1-clearing-core/noviscia-clearing/Cargo.toml --tools-version v1.49 -- --locked
anchor idl build -p noviscia_clearing -o target/idl/noviscia_clearing.json

for src in "$CARGO_TARGET_DIR/deploy/noviscia_clearing.so"; do
  if [[ -f "$src" ]]; then
    cp "$src" target/deploy/noviscia_clearing.so
    break
  fi
done

if [[ ! -f target/deploy/noviscia_clearing.so ]]; then
  echo "Missing noviscia_clearing.so — SBF build did not run." >&2
  exit 1
fi

echo "Upgrading noviscia_clearing at GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe ..."
solana program deploy target/deploy/noviscia_clearing.so \
  --program-id GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe \
  --keypair "${ANCHOR_WALLET}"

bash "$ROOT/scripts/deploy/sync-idls.sh"
bash "$ROOT/scripts/deploy/upload-one-idl-devnet.sh" noviscia_clearing
echo "Done — noviscia_clearing upgraded (hardened prediction-market engine)."
