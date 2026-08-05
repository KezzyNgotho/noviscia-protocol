#!/usr/bin/env bash
# Upgrade devnet nv-usdc-vault (bounded NAV-delta checks on update_total_assets/accrue_vault_yield).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/new-id.json}"
export TMPDIR="${TMPDIR:-$ROOT/.cache/tmp}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.cache/cargo-target}"
mkdir -p "$TMPDIR" "$CARGO_TARGET_DIR/deploy" target/deploy

solana config set --url devnet

echo "Building nv-usdc-vault (TMPDIR=$TMPDIR)..."
cargo build-sbf --manifest-path programs/nv-usdc-vault/Cargo.toml --tools-version v1.52 -- --locked
anchor idl build -p nv_usdc_vault -o target/idl/nv_usdc_vault.json

for src in "$CARGO_TARGET_DIR/deploy/nv_usdc_vault.so" "$CARGO_TARGET_DIR/deploy/nv-usdc-vault.so"; do
  if [[ -f "$src" ]]; then
    cp "$src" target/deploy/nv_usdc_vault.so
    break
  fi
done

if [[ ! -f target/deploy/nv_usdc_vault.so ]]; then
  echo "Missing nv_usdc_vault.so — SBF build did not run." >&2
  exit 1
fi

echo "Upgrading nv-usdc-vault at CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC ..."
solana program deploy target/deploy/nv_usdc_vault.so \
  --program-id CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC \
  --keypair "${ANCHOR_WALLET}"

bash "$ROOT/scripts/deploy/sync-idls.sh"
echo "Done — nv-usdc-vault upgraded (compound is now a ledger-consistent snapshot reset; no phantom total_assets/shares)."
