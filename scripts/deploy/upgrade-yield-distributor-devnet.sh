#!/usr/bin/env bash
# Upgrade devnet yield-distributor:
#  - extracts split_yield_amount as a pure helper (behavior-preserving)
#  - compensate_yield: binds user_token_account.owner == user.key() (fixes a
#    destination-binding gap where admin could credit one user's bookkeeping
#    while paying out to an arbitrary token account)
#  - compensate_yield: caps a single payout at the recipient's lifetime
#    total_earned (MAX_COMPENSATION_VS_EARNED_BPS)
# Backed by new unit tests in src/tests.rs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/new-id.json}"
export TMPDIR="${TMPDIR:-$ROOT/.cache/tmp}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.cache/cargo-target}"
mkdir -p "$TMPDIR" "$CARGO_TARGET_DIR/deploy" target/deploy

solana config set --url devnet

echo "Building yield-distributor (TMPDIR=$TMPDIR)..."
cargo build-sbf --manifest-path programs/yield-distributor/Cargo.toml --tools-version v1.52 -- --locked
anchor idl build -p yield_distributor -o target/idl/yield_distributor.json

for src in "$CARGO_TARGET_DIR/deploy/yield_distributor.so" "$CARGO_TARGET_DIR/deploy/yield-distributor.so"; do
  if [[ -f "$src" ]]; then
    cp "$src" target/deploy/yield_distributor.so
    break
  fi
done

if [[ ! -f target/deploy/yield_distributor.so ]]; then
  echo "Missing yield_distributor.so — SBF build did not run." >&2
  exit 1
fi

echo "Upgrading yield-distributor at CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw ..."
solana program deploy target/deploy/yield_distributor.so \
  --program-id CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw \
  --keypair "${ANCHOR_WALLET}"

bash "$ROOT/scripts/sync-idls.sh"
echo "Done — yield-distributor upgraded (compensate_yield destination-binding + earned-cap active)."
