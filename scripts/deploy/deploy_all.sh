#!/bin/bash

# Novisca Deployment Script - All Programs
# Usage: ./deploy_all.sh [network]
# Networks: localnet, devnet, testnet, mainnet

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NETWORK=${1:-devnet}
PROGRAMS=(
  "escrow"
  "lending-integrator"
  "staking-manager"
  "burn-engine"
  "token-nvsc"
  "yield-distributor"
)

echo "🚀 Deploying Novisca Protocol to $NETWORK"
echo "=========================================="

if ! command -v solana >/dev/null 2>&1; then
  echo "Solana CLI not found. Run: $ROOT_DIR/solana-install.sh" >&2
  exit 1
fi

"$ROOT_DIR/scripts/deploy/sync_program_ids.sh"

# Set Solana cluster
if [ "$NETWORK" = "localnet" ]; then
  solana config set --url http://127.0.0.1:8899
  echo "✅ Set cluster to localnet"
elif [ "$NETWORK" = "devnet" ]; then
  solana config set --url https://api.devnet.solana.com
  echo "✅ Set cluster to devnet"
elif [ "$NETWORK" = "testnet" ]; then
  solana config set --url https://api.testnet.solana.com
  echo "✅ Set cluster to testnet"
elif [ "$NETWORK" = "mainnet" ]; then
  solana config set --url https://api.mainnet-beta.solana.com
  echo "✅ Set cluster to mainnet"
else
  echo "❌ Invalid network: $NETWORK"
  exit 1
fi

# Build all programs
echo ""
echo "🔨 Building programs..."
npm run build

# Deploy each program
for PROGRAM in "${PROGRAMS[@]}"; do
  echo ""
  echo "📦 Deploying $PROGRAM..."
  cd programs/$PROGRAM
  anchor deploy
  cd ../..
done

echo ""
echo "✅ Deployment complete!"
echo "📝 Update your .env file with the deployed program IDs"
