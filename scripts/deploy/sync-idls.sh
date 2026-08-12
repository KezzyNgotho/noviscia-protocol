#!/usr/bin/env bash
# Copy Anchor IDLs into the Next.js app after `anchor build`.
set -euo pipefail
# This script lives at scripts/deploy/, so the repo root is two levels up.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Prefer freshly built target/idl (anchor idl build / deploy scripts).
if [[ -d "$ROOT/target/idl" ]]; then
  IDL="$ROOT/target/idl"
elif [[ -d "$ROOT/.cache/cargo-target/idl" ]]; then
  IDL="$ROOT/.cache/cargo-target/idl"
else
  echo "Run 'anchor build --ignore-keys' first (no IDL dir found)." >&2
  exit 1
fi
WEB="$ROOT/app/web/app/idl"

mkdir -p "$WEB"
for f in escrow position_tracker noviscia_lending burn_engine staking_manager nv_usdc_vault yield_distributor liquidation_vault bug_bounty noviscia_clearing; do
  if [[ -f "$IDL/${f}.json" ]]; then
    cp "$IDL/${f}.json" "$WEB/"
    echo "Copied ${f}.json"
  fi
done
cp "$WEB/position_tracker.json" "$ROOT/app/web/src/idl/position_tracker.json" 2>/dev/null || true
echo "IDL sync complete."
