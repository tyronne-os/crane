#!/bin/bash
set -e

PROJECT_ROOT="/mnt/NOBILITY_VAULT/qwen-kiro-ide"
BACKEND_BIN="$PROJECT_ROOT/target/release/crane-backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend-static"
FRONTEND_PORT=5173
BACKEND_PORT=8002

# Verify backend binary exists
if [ ! -f "$BACKEND_BIN" ]; then
  echo "❌ Backend binary not found at $BACKEND_BIN"
  echo "Run: cd $PROJECT_ROOT/backend && cargo build --release"
  exit 1
fi

# Verify frontend exists
if [ ! -f "$FRONTEND_DIR/index.html" ]; then
  echo "❌ Frontend not found at $FRONTEND_DIR/index.html"
  exit 1
fi

# Start backend
echo "🏗️  Starting CRANE Backend..."
"$BACKEND_BIN" &
BACKEND_PID=$!
sleep 2

# Check if backend started
if ! kill -0 $BACKEND_PID 2>/dev/null; then
  echo "❌ Failed to start backend"
  exit 1
fi

echo "✅ Backend started (PID: $BACKEND_PID)"

# Start simple HTTP server for frontend
echo "🌐 Starting Frontend Server (port $FRONTEND_PORT)..."
cd "$FRONTEND_DIR"
python3 -m http.server $FRONTEND_PORT > /dev/null 2>&1 &
FRONTEND_PID=$!
sleep 1

echo "✅ Frontend started (PID: $FRONTEND_PID)"
echo ""
echo "╔════════════════════════════════════════╗"
echo "║  🏗️  CRANE is running!                  ║"
echo "║                                        ║"
echo "║  Frontend: http://localhost:$FRONTEND_PORT         ║"
echo "║  Backend:  http://localhost:$BACKEND_PORT         ║"
echo "║                                        ║"
echo "║  Press Ctrl+C to stop                  ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Open browser (if available)
if command -v xdg-open &> /dev/null; then
  sleep 1
  xdg-open "http://localhost:$FRONTEND_PORT" &
fi

# Keep processes alive
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" EXIT INT TERM

wait $BACKEND_PID $FRONTEND_PID
