#!/usr/bin/env bash
# Upgrade devnet staking-manager (extracts tier_discount_pct,
# compute_rewards_rate, compute_quorum_min as pure helpers; behavior-preserving
# DRY refactors backing new unit tests in src/tests.rs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/new-id.json}"
export TMPDIR="${TMPDIR:-$ROOT/.cache/tmp}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.cache/cargo-target}"
mkdir -p "$TMPDIR" "$CARGO_TARGET_DIR/deploy" target/deploy

solana config set --url devnet

echo "Building staking-manager (TMPDIR=$TMPDIR)..."
cargo build-sbf --manifest-path programs/staking-manager/Cargo.toml --tools-version v1.52 -- --locked
anchor idl build -p staking_manager -o target/idl/staking_manager.json

for src in "$CARGO_TARGET_DIR/deploy/staking_manager.so" "$CARGO_TARGET_DIR/deploy/staking-manager.so"; do
  if [[ -f "$src" ]]; then
    cp "$src" target/deploy/staking_manager.so
    break
  fi
done

if [[ ! -f target/deploy/staking_manager.so ]]; then
  echo "Missing staking_manager.so — SBF build did not run." >&2
  exit 1
fi

echo "Upgrading staking-manager at 4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75 ..."
solana program deploy target/deploy/staking_manager.so \
  --program-id 4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75 \
  --keypair "${ANCHOR_WALLET}"

bash "$ROOT/scripts/deploy/sync-idls.sh"
bash "$ROOT/scripts/deploy/upload-one-idl-devnet.sh" staking_manager
echo "Done — staking-manager upgraded (tier_discount_pct/compute_rewards_rate/compute_quorum_min extracted)."
