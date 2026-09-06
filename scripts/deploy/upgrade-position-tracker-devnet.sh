#!/usr/bin/env bash
# Upgrade devnet position-tracker — removes Switchboard oracle (Pyth-only).
# Built with LTO + opt-level=s + strip + codegen-units=1 for minimal binary.
#
# Buffer rent: ~14.6 SOL for 2.1MB binary (refunded after finalize).
# Total SOL needed: ~15 SOL (buffer rent + tx fee).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/new-id.json}"
export TMPDIR="${TMPDIR:-$ROOT/.cache/tmp}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.cache/cargo-target}"
mkdir -p "$TMPDIR" "$CARGO_TARGET_DIR/deploy" target/deploy

PROGRAM_ID="6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws"

solana config set --url devnet

BALANCE=$(solana balance --url devnet | awk '{print $1}')
echo "Current balance: $BALANCE SOL"
if (( $(echo "$BALANCE < 15" | bc -l) )); then
  echo "ERROR: Need at least 15 SOL. Have $BALANCE SOL." >&2
  exit 1
fi

echo "Building position_tracker (Switchboard removed, optimized)..."
cargo build-sbf --manifest-path programs/cluster-1-clearing-core/position-tracker/Cargo.toml --tools-version v1.49

# Copy from SBF build output
SBF_OUT="$ROOT/target/sbpf-solana-solana/release/position_tracker.so"
if [[ -f "$SBF_OUT" ]]; then
  cp "$SBF_OUT" target/deploy/position_tracker.so
else
  # Fallback to CARGO_TARGET_DIR
  for src in "$CARGO_TARGET_DIR/deploy/position_tracker.so" "$CARGO_TARGET_DIR/deploy/position-tracker.so"; do
    if [[ -f "$src" ]]; then
      cp "$src" target/deploy/position_tracker.so
      break
    fi
  done
fi

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
echo "Done — position-tracker upgraded (Switchboard removed, Pyth-only, optimized)."
