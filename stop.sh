#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$ROOT_DIR/.prayas-dev"

kill_pid_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file")"
    kill "$pid" 2>/dev/null || true
    rm -f "$file"
  fi
}

kill_pid_file "$STATE_DIR/backend.pid"
kill_pid_file "$STATE_DIR/frontend.pid"

# --reload and Next dev each spawn a child; clean up listeners left by them.
for port in 8000 3000; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
  fi
done

echo "Prayas backend + frontend stopped"

