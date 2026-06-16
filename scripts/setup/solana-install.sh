#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_HINT="$HOME/.local/share/solana/install/active_release/bin"

if command -v solana >/dev/null 2>&1; then
  echo "Solana CLI is already installed: $(solana --version)"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install Solana CLI." >&2
  exit 1
fi

echo "Installing Solana CLI to the standard user location..."
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

if [ -x "$INSTALL_HINT/solana" ]; then
  echo "\nSolana installed successfully. Add this to your shell profile if needed:"
  echo "export PATH=\"$INSTALL_HINT:\$PATH\""
  echo "\nVerify with: solana --version"
else
  echo "Solana installer finished, but the expected binary was not found at: $INSTALL_HINT" >&2
  exit 1
fi
