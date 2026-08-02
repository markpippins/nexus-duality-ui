#!/usr/bin/env bash
#
# rebuild.sh — Stop and restart this Nexus React/Vite UI.
#
# This script performs a kill-and-restart of the Vite dev server for the UI
# living in the SAME directory as this script. It:
#   1. Stops any running `vite --port <port>` for this UI
#   2. Removes the stale Vite dep-optimizer cache (node_modules/.vite)
#   3. Relaunches `npm run dev` fully detached (survives shell exit)
#
# Usage:   ./rebuild.sh
# No arguments needed — port and command are auto-detected from this folder.
#
set -euo pipefail

# Resolve the directory this script lives in (the UI project root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Detect port from package.json `dev` script (vite --port=NNNN) ---
detect_port() {
  if [[ -f package.json ]]; then
    local p
    p="$(grep -oE 'vite --port[= ]?[0-9]+' package.json | grep -oE '[0-9]+' | head -1)"
    [[ -n "$p" ]] && { echo "$p"; return; }
  fi
  echo ""
}

PORT="$(detect_port)"
START_CMD="npm run dev"
UI_NAME="$(basename "$SCRIPT_DIR")"
LOG_FILE="/tmp/opencode/${UI_NAME}.rebuild.log"

echo "=== Rebuilding ${UI_NAME} ==="
echo "  directory : $SCRIPT_DIR"
echo "  port      : ${PORT:-<unknown>}"
echo "  command   : $START_CMD"
echo "  log       : $LOG_FILE"

# --- 1. Stop any running vite dev server on this port ---
if [[ -n "$PORT" ]]; then
  echo "--- Stopping any running instance on port $PORT ---"
  # Find PIDs listening on the port (IPv4 and IPv6) and kill them.
  PIDS="$(ss -tlnp 2>/dev/null | grep ":$PORT" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)"
  if [[ -n "$PIDS" ]]; then
    echo "  killing PIDs: $PIDS"
    # shellcheck disable=SC2086
    kill $PIDS 2>/dev/null || true
    sleep 2
    # Force-kill if still alive
    # shellcheck disable=SC2086
    kill -9 $PIDS 2>/dev/null || true
  else
    echo "  no process found listening on $PORT"
  fi
  # Also kill any stray vite for this port (belt and suspenders)
  pkill -f "vite --port[= ]?$PORT" 2>/dev/null || true
  sleep 1
fi

# --- 2. Clear stale Vite dep-optimizer cache ---
echo "--- Clearing node_modules/.vite ---"
if [[ -d node_modules/.vite ]]; then
  rm -rf node_modules/.vite
  echo "  cache removed"
else
  echo "  no .vite cache directory present (nothing to clear)"
fi

# --- 3. Relaunch detached ---
echo "--- Launching $START_CMD (detached) ---"
# setsid + redirect ensures the process survives the parent shell exiting.
nohup setsid bash -c "exec $START_CMD" > "$LOG_FILE" 2>&1 < /dev/null & disown

NEW_PID=$!
echo "  launched PID: $NEW_PID"

# --- 4. Wait and verify ---
if [[ -n "$PORT" ]]; then
  echo "--- Waiting for port $PORT to bind (up to 90s) ---"
  for i in $(seq 1 90); do
    if ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
      echo "  port $PORT is listening ✅"
      break
    fi
    sleep 1
  done
  if ! ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
    echo "  WARNING: port $PORT not listening after 90s. Check $LOG_FILE"
    echo "  last log lines:"
    tail -15 "$LOG_FILE" 2>/dev/null || true
    exit 1
  fi
  # HTTP smoke test
  if curl -s --max-time 5 "http://localhost:${PORT}/" -o /dev/null; then
    echo "  HTTP check on :$PORT OK ✅"
  else
    echo "  WARNING: HTTP request to :$PORT failed — see $LOG_FILE"
  fi
fi

echo "=== ${UI_NAME} rebuild complete ==="
echo "  URL: http://localhost:${PORT}"
echo "  Log: $LOG_FILE"
