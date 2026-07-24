#!/usr/bin/env bash
# Local LLM setup for Noviscia AI stack
set -e

echo "Installing Ollama (if missing)…"
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

echo "Pulling qwen2.5:7b…"
ollama pull qwen2.5:7b

echo "Smoke test…"
ollama run qwen2.5:7b "Return JSON: {\"test\": \"hello\"}" | head -5

echo "Install AI orchestrator deps…"
cd "$(dirname "$0")/../services/ai-orchestrator" && npm install

echo "Done. Start: cd services/ai-orchestrator && npm run dev"
