#!/bin/bash

# Setup local Solana validator with the canonical tvv pair:
#   noviscia-tvv-gate  (A1cYVV1PjhHgJfiKZzPsjo6Bf7E8NNkMdiv4xNkTaU9g)
#   noviscia-omni-pool (2t5zfcgpdWW5MH4PrQjRDyqVB5MhbwwKFFQJN3VZogAr)
# plus Whirlpool + Phoenix venues used by the tvv harness.

set -e

echo "🔧 Setting up local Solana validator..."

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if ! nc -z localhost 8899 2>/dev/null; then
  echo "⚠️  Starting solana-test-validator on localhost:8899..."
  solana-test-validator \
    --reset \
    --mint 1000000000 \
    --faucet-sol 1000 \
    --bpf-program A1cYVV1PjhHgJfiKZzPsjo6Bf7E8NNkMdiv4xNkTaU9g "$ROOT/target/deploy/noviscia_tvv_gate.so" \
    --bpf-program 2t5zfcgpdWW5MH4PrQjRDyqVB5MhbwwKFFQJN3VZogAr "$ROOT/target/deploy/noviscia_omni_pool.so" \
    --bpf-program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc /tmp/whirlpool/target/deploy/whirlpool.so \
    --bpf-program PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY /tmp/phoenix.so \
    &
  sleep 5
else
  echo "✅ Validator already running"
fi

solana config set --url http://127.0.0.1:8899

echo "💰 Funding test account..."
solana airdrop 100 --url http://127.0.0.1:8899

echo ""
echo "✅ Local setup complete!"
echo "📊 Validator running on: http://127.0.0.1:8899"
echo ""
echo "To stop validator: pkill solana-test-validator"