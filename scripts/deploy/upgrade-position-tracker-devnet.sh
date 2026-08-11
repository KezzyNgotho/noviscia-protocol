#!/usr/bin/env bash
# Upgrade devnet position-tracker (session delegation + keeper_trigger_burn).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/new-id.json}"
export TMPDIR="${TMPDIR:-$ROOT/.cache/tmp}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.cache/cargo-target}"
mkdir -p "$TMPDIR" "$CARGO_TARGET_DIR/deploy" target/deploy

solana config set --url devnet

echo "Building position_tracker (TMPDIR=$TMPDIR)..."
cargo build-sbf --manifest-path programs/position-tracker/Cargo.toml --tools-version v1.52 -- --locked
anchor idl build -p position_tracker -o target/idl/position_tracker.json

for src in "$CARGO_TARGET_DIR/deploy/position_tracker.so" "$CARGO_TARGET_DIR/deploy/position-tracker.so"; do
  if [[ -f "$src" ]]; then
    cp "$src" target/deploy/position_tracker.so
    break
  fi
done

if [[ ! -f target/deploy/position_tracker.so ]]; then
  echo "Missing position_tracker.so — SBF build did not run." >&2
  exit 1
fi

echo "Upgrading position-tracker at 3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY ..."
solana program deploy target/deploy/position_tracker.so \
  --program-id 3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY \
  --keypair "${ANCHOR_WALLET}"

bash "$ROOT/scripts/deploy/sync-idls.sh"
bash "$ROOT/scripts/deploy/upload-one-idl-devnet.sh" position_tracker
echo "Done. Run: npm run verify:burn-authority && npm run verify:kamino-devnet"
