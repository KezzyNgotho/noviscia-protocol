#!/usr/bin/env bash
# Upgrade devnet position-tracker — removes Switchboard oracle (Pyth-only).
# Binary is slightly smaller than on-chain (2.62MB vs 2.63MB), so the
# upgrade cost is minimal (buffer rent + tx fee, old rent refunded).
#
# Requires ~18 SOL for buffer rent (refunded after finalize).
# Current balance: check with `solana balance --url devnet`
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/new-id.json}"
export TMPDIR="${TMPDIR:-$ROOT/.cache/tmp}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.cache/cargo-target}"
mkdir -p "$TMPDIR" "$CARGO_TARGET_DIR/deploy" target/deploy

PROGRAM_ID="6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws"

solana config set --url devnet

echo "Building position_tracker (removing Switchboard)..."
cargo build-sbf --manifest-path programs/position-tracker/Cargo.toml --tools-version v1.52

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

SIZE=$(wc -c < target/deploy/position_tracker.so)
echo "Binary size: $SIZE bytes"
echo "Upgrading position-tracker at $PROGRAM_ID ..."

solana program deploy target/deploy/position_tracker.so \
  --program-id "$PROGRAM_ID" \
  --keypair "${ANCHOR_WALLET}"

echo "Upload updated IDL..."
bash "$ROOT/scripts/deploy/upload-one-idl-devnet.sh" position_tracker
echo "Done — position-tracker upgraded (Switchboard removed, Pyth-only)."
