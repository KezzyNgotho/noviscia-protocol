#!/usr/bin/env bash
# Upload all Anchor IDLs to devnet (anchor 0.31.1 via avm).
#
# Usage:
#   npm run idl:upload-devnet
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.avm/bin:${PATH}"
unset npm_config_devdir

AVM_ANCHOR="${HOME}/.avm/bin/anchor"
if [[ ! -x "$AVM_ANCHOR" ]]; then
  echo "Install Anchor 0.31.1: avm install 0.31.1 && avm use 0.31.1" >&2
  exit 1
fi

upload_one() {
  local name="$1"
  local idl_file="$2"
  local program_id="$3"
  local idl="${ROOT}/target/idl/${idl_file}"
  if [[ ! -f "$idl" ]]; then
    echo "• skip ${name}: ${idl} missing (run: anchor build)" >&2
    return 0
  fi
  node -e "
    const fs=require('fs');
    const p='${idl}';
    const j=JSON.parse(fs.readFileSync(p));
    j.address='${program_id}';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
  "
  echo "→ ${name} (${program_id})"
  if "$AVM_ANCHOR" idl fetch "$program_id" --provider.cluster devnet -o /dev/null 2>/dev/null; then
    "$AVM_ANCHOR" idl upgrade --filepath "$idl" "$program_id" --provider.cluster devnet
  else
    "$AVM_ANCHOR" idl init --filepath "$idl" "$program_id" --provider.cluster devnet
  fi
}

# name, idl_filename, program_id
upload_one burn_engine burn_engine.json nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id
upload_one escrow escrow.json CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D
upload_one lending_integrator noviscia_lending.json Ea5TXHxsVcnKwMAcAsQkpPN88xr8ndBRpNGDkREWrbSZ
upload_one nv_usdc_vault nv_usdc_vault.json CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC
upload_one position_tracker position_tracker.json 3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY
upload_one staking_manager staking_manager.json 4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75
upload_one token_nvsc token_nvsc.json HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT
upload_one yield_distributor yield_distributor.json CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw
upload_one prediction_market prediction_market.json 3BTcArdsxKhzF2Msjm3JLy343v6ZvQjPusq3V2zRNbpv
upload_one liquidation_vault liquidation_vault.json C5mvuPTN7KHQ1NsXSUcD2tEae9fL1pLrNkZD67jRRuf1

echo ""
echo "✅ IDL upload pass complete"
