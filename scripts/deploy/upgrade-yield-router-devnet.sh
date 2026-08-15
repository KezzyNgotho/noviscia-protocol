#!/usr/bin/env bash
# Deploy devnet yield_router — the Atomic Recall orchestrator (Pillar 4).
# Program ID: FKaAPPid8B6hUme4w8bFCDzmvE6DpekXpeiR1sgyLwB4
#   (must match nv-usdc-vault's hardcoded YIELD_ROUTER_PROGRAM_ID)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/new-id.json}"
export TMPDIR="${TMPDIR:-$ROOT/.cache/tmp}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.cache/cargo-target}"
mkdir -p "$TMPDIR" "$CARGO_TARGET_DIR/deploy" target/deploy

solana config set --url devnet

echo "Building yield_router (TMPDIR=$TMPDIR)..."
cargo build-sbf --manifest-path programs/yield-router/Cargo.toml --tools-version v1.52 -- --locked
anchor idl build -p yield_router -o target/idl/yield_router.json

for src in "$CARGO_TARGET_DIR/deploy/yield_router.so"; do
  if [[ -f "$src" ]]; then
    cp "$src" target/deploy/yield_router.so
    break
  fi
done

if [[ ! -f target/deploy/yield_router.so ]]; then
  echo "Missing yield_router.so — SBF build did not run." >&2
  exit 1
fi

# Program keypair (its pubkey == FKaAPPid8B6hUme4w8bFCDzmvE6DpekXpeiR1sgyLwB4).
PROGRAM_KEYPAIR="$ROOT/.keys/yield-router-devnet.json"
if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
  echo "Missing $PROGRAM_KEYPAIR — cannot sign deploy." >&2
  exit 1
fi
cp "$PROGRAM_KEYPAIR" target/deploy/yield_router-keypair.json

echo "Deploying yield_router at FKaAPPid8B6hUme4w8bFCDzmvE6DpekXpeiR1sgyLwB4 ..."
solana program deploy target/deploy/yield_router.so \
  --program-id "$PROGRAM_KEYPAIR" \
  --upgrade-authority "${ANCHOR_WALLET}" \
  --keypair "${ANCHOR_WALLET}"

bash "$ROOT/scripts/deploy/sync-idls.sh"
bash "$ROOT/scripts/deploy/upload-one-idl-devnet.sh" yield_router
echo "Done — yield_router deployed."
