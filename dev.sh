#!/usr/bin/env bash
# Local dev helper — handles venv, database, env vars, and common tasks
# Usage: ./dev.sh [start|test|build|stop]
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
VENV="$BACKEND_DIR/.venv/bin"
DATABASE_URL="postgresql://askmura:localdev@localhost:5432/askmura"

# ── Helpers ──────────────────────────────────────────────────────────

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

check_postgres() {
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q postgres; then
    echo "→ Starting Postgres..."
    docker compose -f "$PROJECT_DIR/docker-compose.yml" up -d
    sleep 2
  fi
  if docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres pg_isready -U askmura -q 2>/dev/null; then
    green "✓ Postgres running"
  else
    red "✗ Postgres not ready — check: docker compose logs postgres"
    exit 1
  fi
}

check_venv() {
  if [ ! -f "$VENV/python" ]; then
    red "✗ Backend venv not found at $VENV"
    echo "  Run: cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt"
    exit 1
  fi
  green "✓ Backend venv OK"
}

kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 1
  fi
}

# ── Commands ─────────────────────────────────────────────────────────

cmd_start() {
  bold "Starting local dev environment..."
  check_venv
  check_postgres

  # Kill existing processes on our ports
  kill_port 8001
  kill_port 3000

  # Start backend
  echo "→ Starting backend on :8001..."
  DATABASE_URL="$DATABASE_URL" "$VENV/uvicorn" main:app --host 0.0.0.0 --port 8001 \
    --app-dir "$BACKEND_DIR" &
  BACKEND_PID=$!

  # Start frontend
  echo "→ Starting frontend on :3000..."
  (cd "$FRONTEND_DIR" && npm run dev) &
  FRONTEND_PID=$!

  green "✓ Backend PID=$BACKEND_PID  Frontend PID=$FRONTEND_PID"
  bold "  http://localhost:3000 (frontend)"
  bold "  http://localhost:8001 (backend)"
  echo ""
  echo "Press Ctrl+C to stop both."

  trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
  wait
}

cmd_test() {
  bold "Running tests..."
  check_venv
  check_postgres

  if [ "${1:-}" = "--slow" ]; then
    echo "→ Including slow (LLM) tests"
    DATABASE_URL="$DATABASE_URL" JWT_SECRET="test-secret" \
      "$VENV/python" -m pytest "$BACKEND_DIR/tests/" -m "" -v
  else
    echo "→ Fast tests only (add --slow for LLM tests)"
    DATABASE_URL="$DATABASE_URL" JWT_SECRET="test-secret" \
      "$VENV/python" -m pytest "$BACKEND_DIR/tests/" -v
  fi
}

cmd_build() {
  local skip_tests=false
  if [ "${1:-}" = "--skip-tests" ]; then
    skip_tests=true
  fi

  bold "Building frontend..."
  (cd "$FRONTEND_DIR" && npm run build)
  green "✓ Frontend build OK"

  bold "Checking backend imports..."
  check_venv
  check_postgres
  DATABASE_URL="$DATABASE_URL" JWT_SECRET="test-secret" \
    "$VENV/python" -c "import sys; sys.path.insert(0, '$BACKEND_DIR'); from main import app; print('Imports OK')"
  green "✓ Backend imports OK"

  if ! $skip_tests; then
    cmd_test
  else
    echo "→ Skipping tests (--skip-tests)"
  fi
}

cmd_stop() {
  bold "Stopping local services..."
  kill_port 8001
  kill_port 3000
  green "✓ Stopped backend and frontend"
}

# ── Main ─────────────────────────────────────────────────────────────

case "${1:-help}" in
  start) cmd_start ;;
  test)  cmd_test "${2:-}" ;;
  build) cmd_build "${2:-}" ;;
  stop)  cmd_stop ;;
  *)
    echo "Usage: ./dev.sh <command>"
    echo ""
    echo "Commands:"
    echo "  start       Start backend + frontend (auto-starts Postgres)"
    echo "  test        Run pytest (fast tests only)"
    echo "  test --slow Run all tests including LLM golden-set"
    echo "  build              Build frontend + check imports + run tests"
    echo "  build --skip-tests Build frontend + check imports (no tests)"
    echo "  stop        Kill backend + frontend processes"
    ;;
esac
