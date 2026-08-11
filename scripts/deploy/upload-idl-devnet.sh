#!/usr/bin/env bash
# Upload all Anchor IDLs to devnet (anchor 0.31.1 via avm).
# Each program is handled by upload-one-idl-devnet.sh, which grows the
# canonical IDL account (close + re-init) whenever a new IDL no longer fits.
#
# Usage:
#   npm run idl:upload-devnet
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

for name in \
  burn_engine \
  escrow \
  lending_integrator \
  nv_usdc_vault \
  position_tracker \
  staking_manager \
  token_nvsc \
  yield_distributor \
  prediction_market \
  liquidation_vault \
  bug_bounty \
; do
  bash "$ROOT/scripts/deploy/upload-one-idl-devnet.sh" "$name"
done

echo ""
echo "✅ IDL upload pass complete"
