#!/usr/bin/env bash
# Upgrade devnet liquidation-vault (extracts compute_liquidation_profit,
# compute_user_share_bps, compute_user_profit, shares_to_usdc as pure helpers;
# behavior-preserving DRY refactors backing new unit tests in src/tests.rs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/new-id.json}"
export TMPDIR="${TMPDIR:-$ROOT/.cache/tmp}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.cache/cargo-target}"
mkdir -p "$TMPDIR" "$CARGO_TARGET_DIR/deploy" target/deploy

solana config set --url devnet

echo "Building liquidation-vault (TMPDIR=$TMPDIR)..."
cargo build-sbf --manifest-path programs/active/liquidation-vault/Cargo.toml --tools-version v1.49 -- --locked
anchor idl build -p liquidation_vault -o target/idl/liquidation_vault.json

for src in "$CARGO_TARGET_DIR/deploy/liquidation_vault.so" "$CARGO_TARGET_DIR/deploy/liquidation-vault.so"; do
  if [[ -f "$src" ]]; then
    cp "$src" target/deploy/liquidation_vault.so
    break
  fi
done

if [[ ! -f target/deploy/liquidation_vault.so ]]; then
  echo "Missing liquidation_vault.so — SBF build did not run." >&2
  exit 1
fi

echo "Upgrading liquidation-vault at Cwma3FfMKhoLkgfrGYgErVPoFWEtHpx7DNc4wArpRHBz ..."
solana program deploy target/deploy/liquidation_vault.so \
  --program-id Cwma3FfMKhoLkgfrGYgErVPoFWEtHpx7DNc4wArpRHBz \
  --keypair "${ANCHOR_WALLET}"

bash "$ROOT/scripts/deploy/sync-idls.sh"
bash "$ROOT/scripts/deploy/upload-one-idl-devnet.sh" liquidation_vault
echo "Done — liquidation-vault upgraded (profit/share/shares_to_usdc helpers extracted)."
