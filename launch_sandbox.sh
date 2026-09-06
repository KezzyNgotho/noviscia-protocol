#!/usr/bin/env bash
# Noviscia accelerated sandbox launcher.
#
# Boots the 1,440x time-compressed clearinghouse loop locally:
#   :10000  gRPC feed        (mock Yellowstone subscriber)
#   :8898   Jito emulator    (JSON-RPC: sendBundle / getTipAccounts)
#   :10001  bundle REST      (spec POST /api/v1/bundles)
#   :10002  control plane    (PUT /api/v1/sandbox/control-plane)
#
# Usage:   ./launch_sandbox.sh
# Stop:    Ctrl-C (graceful) — the sandbox-hub drains on SIGINT.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PORT_GRPC="${SANDBOX_GRPC_PORT:-10000}"
PORT_JSONRPC="${SANDBOX_EMULATOR_PORT:-8898}"
PORT_BUNDLES="${SANDBOX_BUNDLES_PORT:-10001}"
PORT_CONTROL="${SANDBOX_CONTROL_PORT:-10002}"
SLOT_MS="${SANDBOX_SLOT_MS:-400}"   # 400ms = 1,440x window compression

echo "────────────── Noviscia Sandbox ──────────────"
echo "  gRPC feed    → grpc://localhost:$PORT_GRPC"
echo "  Jito emu     → http://localhost:$PORT_JSONRPC"
echo "  bundles REST → http://localhost:$PORT_BUNDLES/api/v1/bundles"
echo "  control      → localhost:$PORT_CONTROL"
echo "  slot clock   → ${SLOT_MS}ms (1,440x)"
echo "───────────────────────────────────────────────"

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo not found in PATH" >&2
  exit 1
fi

SANDBOX_GRPC_PORT="$PORT_GRPC" \
SANDBOX_EMULATOR_PORT="$PORT_JSONRPC" \
SANDBOX_BUNDLES_PORT="$PORT_BUNDLES" \
SANDBOX_CONTROL_PORT="$PORT_CONTROL" \
SANDBOX_SLOT_MS="$SLOT_MS" \
cargo run -p sandbox-hub "$@"