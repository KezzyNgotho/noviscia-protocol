#!/bin/bash

# Noviscia Multi-Service Manager
# Usage: ./run-services.sh [start|stop|restart|status]

set -e

SERVICES=(
  "services/ai-orchestrator:AI Orchestrator:npm run dev"
  "app/api:API Server:npm run dev"
  "services/price-feed:Price Feed:npm run dev"
  "services/indexer:Indexer:npm run dev"
  "services/websocket:WebSocket:npm run dev"
  "services/ai-rebalancer:AI Rebalancer:npm run dev"
  "app/web:Web App:npm run dev"
)

PIDS=()

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

start_services() {
  echo -e "${YELLOW}🚀 Starting Noviscia services...${NC}"
  
  for service in "${SERVICES[@]}"; do
    IFS=':' read -r dir name cmd <<< "$service"
    
    if [ ! -d "$dir" ]; then
      echo -e "${RED}❌ Directory not found: $dir${NC}"
      continue
    fi
    
    echo -e "${GREEN}▶ Starting $name...${NC}"
    (cd "$dir" && $cmd > "../../logs/$name.log" 2>&1 &)
    PIDS+=($!)
    sleep 2
  done
  
  echo -e "${GREEN}✅ All services started!${NC}"
  echo "Logs available in ./logs/ directory"
  
  # Wait for all processes
  wait
}

stop_services() {
  echo -e "${YELLOW}🛑 Stopping Noviscia services...${NC}"
  
  pkill -f "npm run dev" || true
  sleep 1
  
  echo -e "${GREEN}✅ All services stopped${NC}"
}

restart_services() {
  stop_services
  sleep 2
  start_services
}

show_status() {
  echo -e "${YELLOW}📊 Noviscia Services Status${NC}"
  echo ""
  
  for service in "${SERVICES[@]}"; do
    IFS=':' read -r dir name cmd <<< "$service"
    
    if pgrep -f "cd.*$dir" > /dev/null; then
      echo -e "${GREEN}✅ $name - Running${NC}"
    else
      echo -e "${RED}❌ $name - Stopped${NC}"
    fi
  done
}

mkdir -p logs

case "${1:-start}" in
  start)
    start_services
    ;;
  stop)
    stop_services
    ;;
  restart)
    restart_services
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
