#!/usr/bin/env bash
# Deploy/upgrade devnet netting_engine — the multilateral netting & novation
# ledger (68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/new-id.json}"
export TMPDIR="${TMPDIR:-$ROOT/.cache/tmp}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.cache/cargo-target}"
mkdir -p "$TMPDIR" "$CARGO_TARGET_DIR/deploy" target/deploy

solana config set --url devnet

echo "Building netting_engine (TMPDIR=$TMPDIR)..."
cargo build-sbf --manifest-path programs/netting-engine/Cargo.toml --tools-version v1.52 -- --locked
anchor idl build -p netting_engine -o target/idl/netting_engine.json

for src in "$CARGO_TARGET_DIR/deploy/netting_engine.so"; do
  if [[ -f "$src" ]]; then
    cp "$src" target/deploy/netting_engine.so
    break
  fi
done

if [[ ! -f target/deploy/netting_engine.so ]]; then
  echo "Missing netting_engine.so — SBF build did not run." >&2
  exit 1
fi

# Program keypair (its pubkey == 68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56).
# `solana program deploy` requires the program's keypair to sign an initial
# deploy; for upgrades a plain address suffices. The CLI also looks for it
# next to the .so as target/deploy/netting_engine-keypair.json.
PROGRAM_KEYPAIR="$ROOT/.keys/netting-engine-devnet.json"
if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
  echo "Missing $PROGRAM_KEYPAIR — cannot sign initial deploy." >&2
  exit 1
fi
cp "$PROGRAM_KEYPAIR" target/deploy/netting_engine-keypair.json

echo "Deploying netting_engine at 68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56 ..."
solana program deploy target/deploy/netting_engine.so \
  --program-id "$PROGRAM_KEYPAIR" \
  --upgrade-authority "${ANCHOR_WALLET}" \
  --keypair "${ANCHOR_WALLET}"

bash "$ROOT/scripts/deploy/sync-idls.sh"
bash "$ROOT/scripts/deploy/upload-one-idl-devnet.sh" netting_engine
echo "Done — netting_engine deployed."
