#!/usr/bin/env bash
# Upgrade devnet nv-usdc-vault.
#
# NOTE: build the SBF artifact with a *crate-local* CARGO_TARGET_DIR. The
# repo-root .cache/cargo-target holds a STALE copy of nv_usdc_vault.so
# (deploying from it has shipped old logic before) — always build fresh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/new-id.json}"
PROGRAM_DIR="programs/cluster-3-vault-registry/nv-usdc-vault"
PROGRAM_ID="5fmZJ4XsMfQpnM1wMH6DW5KNBAgCQF88762xtDEb94ST"

solana config set --url devnet

echo "=== Building nv-usdc-vault (fresh crate-local cache) ==="
export CARGO_TARGET_DIR="$ROOT/$PROGRAM_DIR/.cache/cargo-target"
rm -f "$CARGO_TARGET_DIR/deploy/nv_usdc_vault.so"
cargo build-sbf \
  --manifest-path "$PROGRAM_DIR/Cargo.toml" \
  --tools-version v1.49 \
  -- \
  --locked
echo "=== Building IDL ==="
anchor idl build -p nv_usdc_vault -o target/idl/nv_usdc_vault.json

SO="$CARGO_TARGET_DIR/deploy/nv_usdc_vault.so"
if [[ ! -f "$SO" ]]; then
  echo "Missing $(realpath "$SO" 2>/dev/null || echo "$SO") — SBF build did not run." >&2
  exit 1
fi
ls -l "$SO"
echo "=== Upgrading nv-usdc-vault at $PROGRAM_ID ==="
solana program deploy "$SO" \
  --program-id "$PROGRAM_ID" \
  --upgrade-authority "${ANCHOR_WALLET}" \
  --keypair "${ANCHOR_WALLET}"

echo "=== Re-syncing + uploading IDL ==="
bash "$ROOT/scripts/deploy/sync-idls.sh"
bash "$ROOT/scripts/deploy/upload-one-idl-devnet.sh" nv_usdc_vault
echo "Done — nv-usdc-vault upgraded."