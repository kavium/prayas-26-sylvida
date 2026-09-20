#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$ROOT_DIR/.prayas-dev"
mkdir -p "$STATE_DIR"

if lsof -tiTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Backend already running on :8000"
else
  (
    cd "$ROOT_DIR/backend"
    nohup .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 \
      >"$STATE_DIR/backend.log" 2>&1 &
    echo $! >"$STATE_DIR/backend.pid"
  )
  echo "Backend started: http://127.0.0.1:8000"
fi

if lsof -tiTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Frontend already running on :3000"
else
  (
    cd "$ROOT_DIR/frontend"
    nohup npm run dev -- --hostname 127.0.0.1 --port 3000 \
      >"$STATE_DIR/frontend.log" 2>&1 &
    echo $! >"$STATE_DIR/frontend.pid"
  )
  echo "Frontend started: http://127.0.0.1:3000"
fi

