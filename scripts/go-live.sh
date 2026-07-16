#!/usr/bin/env bash
# Bring DocChat online: start the backend + the ngrok tunnel together.
# Usage:  ./scripts/go-live.sh          (Ctrl+C stops both)
set -euo pipefail

NGROK_DOMAIN="${NGROK_DOMAIN:-express-landslide-mournful.ngrok-free.dev}"
cd "$(dirname "$0")/../rag-backend"

echo "→ starting backend on :8000"
./venv/bin/uvicorn main:app --port 8000 &
BACKEND_PID=$!

cleanup() { kill "$BACKEND_PID" 2>/dev/null || true; }
trap cleanup EXIT

# wait for the backend to come up before opening the tunnel
until curl -sf http://localhost:8000/health >/dev/null 2>&1; do sleep 1; done
echo "→ backend healthy; opening tunnel https://$NGROK_DOMAIN"
echo "→ app is LIVE at your Vercel URL. Press Ctrl+C to go offline."

ngrok http --domain="$NGROK_DOMAIN" 8000
