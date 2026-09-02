#!/bin/bash

# Setup local Solana validator with programs
# Useful for local development and testing

set -e

echo "🔧 Setting up local Solana validator..."

# Check if validator is running
if ! nc -z localhost 8899 2>/dev/null; then
  echo "⚠️  Starting solana-test-validator on localhost:8899..."
  solana-test-validator \
    --reset \
    --mint 1000000000 \
    --slots-per-epoch 32 \
    --faucet-sol 1000 \
    &
  
  # Wait for validator to start
  sleep 5
else
  echo "✅ Validator already running"
fi

# Set local cluster
solana config set --url http://127.0.0.1:8899

# Fund test account
echo "💰 Funding test account..."
solana airdrop 100 --url http://127.0.0.1:8899

# Build programs
echo "🔨 Building programs..."
npm run build

# Deploy programs
echo "📦 Deploying programs..."
for program in active/staking-manager active/yield-distributor active/token-nvsc later/escrow later/burn-engine; do
  echo "  → Deploying $program..."
  cd programs/$program
  anchor deploy --provider.cluster localnet
  cd ../..
done

echo ""
echo "✅ Local setup complete!"
echo "📊 Validator running on: http://127.0.0.1:8899"
echo "🔍 RPC endpoint: http://127.0.0.1:8899"
echo ""
echo "To stop validator: pkill solana-test-validator"
