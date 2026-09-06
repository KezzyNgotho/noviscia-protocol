#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANCHOR_TOML="$ROOT_DIR/Anchor.toml"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
PROGRAM_DIR="$ROOT_DIR/programs"
DEPLOY_DIR="$ROOT_DIR/target/deploy"
MAP_FILE="$(mktemp)"
WEB3_JS="$ROOT_DIR/app/web/node_modules/@solana/web3.js"

PROGRAMS=(
  "escrow"
  "staking-manager"
  "burn-engine"
  "token-nvsc"
  "yield-distributor"
  "position-tracker"
  "liquidation-vault"
  "noviscia_clearing"
)

declare -A PROGRAM_KEYS

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd node
require_cmd python3

if [ ! -d "$WEB3_JS" ]; then
  echo "Missing bundled Solana JS SDK at: $WEB3_JS" >&2
  exit 1
fi

mkdir -p "$DEPLOY_DIR"

generate_keypair() {
  local program_name="$1"
  local keypair_path="$DEPLOY_DIR/${program_name}-keypair.json"
  node <<NODE
const fs = require('fs');
const { Keypair } = require('$WEB3_JS');
const keypair = Keypair.generate();
fs.writeFileSync('$keypair_path', JSON.stringify(Array.from(keypair.secretKey)));
process.stdout.write(keypair.publicKey.toBase58());
NODE
}

for program in "${PROGRAMS[@]}"; do
  PROGRAM_KEYS["$program"]="$(generate_keypair "$program")"
  printf '%s=%s\n' "$program" "${PROGRAM_KEYS[$program]}" >> "$MAP_FILE"
done

python3 - "$ANCHOR_TOML" "$ENV_EXAMPLE" "$PROGRAM_DIR" "$MAP_FILE" <<'PY'
import re
import sys
from pathlib import Path

anchor_toml = Path(sys.argv[1])
env_example = Path(sys.argv[2])
program_dir = Path(sys.argv[3])
map_file = Path(sys.argv[4])

programs = [
    ("escrow", "ESCROW_PROGRAM_ID"),
    ("staking-manager", "STAKING_PROGRAM_ID"),
    ("burn-engine", "BURN_PROGRAM_ID"),
    ("token-nvsc", "TOKEN_NVSC_PROGRAM_ID"),
    ("yield-distributor", "YIELD_PROGRAM_ID"),
    ("position-tracker", "POSITION_TRACKER_PROGRAM_ID"),
    ("liquidation-vault", "LIQUIDATION_VAULT_PROGRAM_ID"),
  ("noviscia_clearing", "PREDICTION_MARKET_PROGRAM_ID"),
]

program_keys = {}
for line in map_file.read_text().splitlines():
  if "=" in line:
    key, value = line.split("=", 1)
    program_keys[key] = value

anchor_text = anchor_toml.read_text()
for program, _ in programs:
    new_id = program_keys[program]
    anchor_text = re.sub(
        rf'({re.escape(program)}\s*=\s*")([^"]+)(")',
    rf'\g<1>{new_id}\3',
    anchor_text,
    )

anchor_toml.write_text(anchor_text)

env_text = env_example.read_text()
env_updates = {
    "ESCROW_PROGRAM_ID": program_keys["escrow"],
    "STAKING_PROGRAM_ID": program_keys["staking-manager"],
    "BURN_PROGRAM_ID": program_keys["burn-engine"],
    "YIELD_PROGRAM_ID": program_keys["yield-distributor"],
    "POSITION_TRACKER_PROGRAM_ID": program_keys["position-tracker"],
    "LIQUIDATION_VAULT_PROGRAM_ID": program_keys["liquidation-vault"],
  "PREDICTION_MARKET_PROGRAM_ID": program_keys["noviscia_clearing"],
}
for key, value in env_updates.items():
    env_text = re.sub(rf'^{re.escape(key)}=.*$', f'{key}={value}', env_text, flags=re.M)

env_example.write_text(env_text)

lib_map = {
    "escrow": "programs/cluster-4-governance/escrow/src/lib.rs",
    "staking-manager": "programs/cluster-4-governance/staking-manager/src/lib.rs",
    "burn-engine": "programs/cluster-4-governance/burn-engine/src/lib.rs",
    "token-nvsc": "programs/cluster-4-governance/token-nvsc/src/lib.rs",
    "yield-distributor": "programs/cluster-4-governance/yield-distributor/src/lib.rs",
  "position-tracker": "programs/cluster-1-clearing-core/position-tracker/src/lib.rs",
    "liquidation-vault": "programs/cluster-4-governance/liquidation-vault/src/lib.rs",
    "noviscia_clearing": "programs/cluster-1-clearing-core/noviscia-clearing/src/lib.rs",
}

for program, relative_path in lib_map.items():
    path = program_dir.parent / relative_path
    text = path.read_text()
    text = re.sub(
        r'declare_id!\("[^"]+"\);',
        f'declare_id!("{program_keys[program]}");',
        text,
        count=1,
    )
    path.write_text(text)

print("Updated program IDs:")
for program, _ in programs:
    print(f"{program}={program_keys[program]}")
PY

rm -f "$MAP_FILE"

echo "Program IDs synced to Anchor.toml, .env.example, and all declare_id! macros."
echo "Next: run 'cd \"$ROOT_DIR\" && anchor build'"
