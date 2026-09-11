#!/usr/bin/env bash
# Noviscia accelerated sandbox launcher.
#
# Boots the 1,440x time-compressed clearinghouse loop locally:
#   :10000  gRPC feed        (mock Yellowstone subscriber)
#   :8898   Jito emulator    (JSON-RPC: sendBundle / getTipAccounts)
#   :10001  bundle REST      (POST /api/v1/bundles, GET/POST vault+settle)
#   :10002  control plane    (PUT /api/v1/sandbox/control-plane)
#
# Flags (intercepted, not forwarded to the hub):
#   --verify        Boot the hub, run the 4-metric diagnostics runner, print
#                   the institutional checklist, then exit with PASS/FAIL.
#   --with-ledger   (requires solana-test-validator) run Tier-1 local ledger
#                   provisioning before the hub boots.
#
# Usage:   ./launch_sandbox.sh [--verify] [--with-ledger]
# Stop:    Ctrl-C (graceful) — the sandbox-hub drains on SIGINT.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$ROOT")"
cd "$REPO_ROOT/services/sandbox-hub"

PORT_GRPC="${SANDBOX_GRPC_PORT:-10000}"
PORT_JSONRPC="${SANDBOX_EMULATOR_PORT:-8898}"
PORT_BUNDLES="${SANDBOX_BUNDLES_PORT:-10001}"
PORT_CONTROL="${SANDBOX_CONTROL_PORT:-10002}"
SLOT_MS="${SANDBOX_SLOT_MS:-400}"   # 400ms = 1,440x window compression

VERIFY=false
WITH_LEDGER=false
HUB_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --verify)       VERIFY=true ;;
    --with-ledger)  WITH_LEDGER=true ;;
    *)              HUB_ARGS+=("$arg") ;;
  esac
done

echo "────────────── Noviscia Sandbox ──────────────"
echo "  gRPC feed    → grpc://localhost:$PORT_GRPC"
echo "  Jito emu     → http://localhost:$PORT_JSONRPC"
echo "  bundles REST → http://localhost:$PORT_BUNDLES/api/v1/bundles"
echo "  vault        → http://localhost:$PORT_BUNDLES/api/v1/sandbox/vault"
echo "  control      → localhost:$PORT_CONTROL"
echo "  slot clock   → ${SLOT_MS}ms (1,440x)"
if $VERIFY; then
  echo "  mode         → VERIFY (run 4-metric diagnostics, exit PASS/FAIL)"
fi
if $WITH_LEDGER; then
  echo "  tier 1       → with-ledger (provision local validator)"
fi
echo "───────────────────────────────────────────────"

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo not found in PATH" >&2
  exit 1
fi

# ── Tier 1: local ledger provisioning ──────────────────────────────────────
if $WITH_LEDGER; then
  if command -v solana-test-validator >/dev/null 2>&1; then
    echo "Tier 1: provisioning local validator ledger..."
    (cd "$REPO_ROOT" && npx tsx scripts/sandbox/provision-local-ledger.ts --apply)
  else
    echo "warning: solana-test-validator not on PATH — skipping --with-ledger"
  fi
fi

# ── Tier 2+3: hub + diagnostics ───────────────────────────────────────────
if $VERIFY; then
  # Launch the hub in the background and run the 4-metric diagnostics
  # runner against it, printing the institutional checklist on exit.
  echo "Launching sandbox-hub in background..."

  SANDBOX_GRPC_PORT="$PORT_GRPC" \
  SANDBOX_EMULATOR_PORT="$PORT_JSONRPC" \
  SANDBOX_BUNDLES_PORT="$PORT_BUNDLES" \
  SANDBOX_CONTROL_PORT="$PORT_CONTROL" \
  SANDBOX_SLOT_MS="$SLOT_MS" \
  cargo run --bin sandbox-hub "${HUB_ARGS[@]}" &
  HUB_PID=$!
  cleanup() { kill "$HUB_PID" 2>/dev/null; wait "$HUB_PID" 2>/dev/null; }
  trap cleanup EXIT INT TERM

  echo "Waiting for gRPC :$PORT_GRPC to come up..."
  for i in $(seq 1 90); do
    if (echo > /dev/tcp/127.0.0.1/"$PORT_GRPC") 2>/dev/null; then
      echo "gRPC ready after ~${i}s"
      break
    fi
    sleep 1
    if ! kill -0 "$HUB_PID" 2>/dev/null; then
      echo "error: sandbox-hub exited during startup" >&2
      exit 1
    fi
  done

  echo ""
  echo "Running 4-metric diagnostics checklist..."
  echo ""

  cd "$REPO_ROOT"
  cargo run -p noviscia-client --example sandbox_diagnostics
  RC=$?

  echo ""
  if [ "$RC" -eq 0 ]; then
    echo "INSTUTIONAL SANDBOX DIAGNOSTICS: PASS"
  else
    echo "INSTUTIONAL SANDBOX DIAGNOSTICS: FAIL (exit code $RC)"
  fi
  exit "$RC"
else
  # Default: foreground hub (Ctrl-C to stop).
  exec \
    SANDBOX_GRPC_PORT="$PORT_GRPC" \
    SANDBOX_EMULATOR_PORT="$PORT_JSONRPC" \
    SANDBOX_BUNDLES_PORT="$PORT_BUNDLES" \
    SANDBOX_CONTROL_PORT="$PORT_CONTROL" \
    SANDBOX_SLOT_MS="$SLOT_MS" \
    cargo run --bin sandbox-hub "${HUB_ARGS[@]}"
fi
