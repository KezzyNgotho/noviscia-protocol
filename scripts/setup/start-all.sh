#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${NVM_DIR:+$NVM_DIR/versions/node/*/bin:}$PATH"
export PATH="/home/kezz/.config/nvm/versions/node/v24.16.0/bin:$PATH"

export AI_ORCHESTRATOR_URL=http://localhost:11435
export NOVISCIA_WEB_URL=http://localhost:3000
export NOVISCIA_API_URL=http://localhost:3001
export USE_AI_ORCHESTRATOR=1
export WEBSOCKET_INGEST_URL=http://localhost:8080
export USDC_MINT_DEVNET=Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5

mkdir -p "$ROOT/logs"

start() {
  local dir="$1" name="$2"
  echo "▶ $name"
  (cd "$ROOT/$dir" && npm run dev >> "$ROOT/logs/$name.log" 2>&1 &)
}

pkill -f "next dev -p 3000" 2>/dev/null || true
pkill -f "tsx watch src/index" 2>/dev/null || true
sleep 1

start services/ai-orchestrator "AI-Orchestrator"
sleep 1
start app/api "API"
sleep 1
start services/websocket "WebSocket"
sleep 1
start services/ai-rebalancer "AI-Rebalancer"
sleep 1
start app/web "Web"

echo "Waiting for ports…"
sleep 12
ss -tlnp 2>/dev/null | grep -E ':3000|:3001|:8080|:11435' || lsof -iTCP -sTCP:LISTEN 2>/dev/null | grep -E '3000|3001|8080|11435' || true
echo "Logs: $ROOT/logs/"
