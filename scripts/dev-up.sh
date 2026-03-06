#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVER_PORT="${DAIERYOU_WS_PORT:-3014}"
CLIENT_PORT="${DAIERYOU_CLIENT_PORT:-3000}"
SKIP_MONGO="${DAIERYOU_SKIP_MONGO:-0}"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "[dev-up] Installing workspace dependencies ..."
  npm install
fi

echo "[dev-up] Starting server on ws://localhost:${SERVER_PORT} ..."
DAIERYOU_SKIP_MONGO="$SKIP_MONGO" \
DAIERYOU_WS_PORT="$SERVER_PORT" \
npm --prefix "$ROOT_DIR/server" run start &
SERVER_PID=$!

echo "[dev-up] Starting client on http://localhost:${CLIENT_PORT} ..."
VITE_WS_URL="ws://localhost:${SERVER_PORT}" \
npm --prefix "$ROOT_DIR/client" run dev -- --host 0.0.0.0 --port "$CLIENT_PORT" &
CLIENT_PID=$!

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "${CLIENT_PID:-}" ]] && kill -0 "$CLIENT_PID" 2>/dev/null; then
    kill "$CLIENT_PID" 2>/dev/null || true
  fi
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  wait || true
}

trap cleanup EXIT INT TERM

while true; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$CLIENT_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done
