#!/bin/bash
set -e

# ── CRANE Launcher ────────────────────────────────────────────────────────────
# Starts: backend, Miranda 3B voice brain, optional Parakeet ASR, optional TTS
# All model paths resolve from NOBILITY_VAULT (your 100GB local SSD)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULT="${NOBILITY_VAULT:-/mnt/NOBILITY_VAULT}"
CRANE_HOME="${CRANE_HOME:-$HOME/crane-projects}"
BACKEND_PORT="${CRANE_BACKEND_PORT:-8002}"
MIRANDA_PORT=8003
PARAKEET_PORT=8004
TTS_PORT=8005

# ── Model paths (best uncensored conversational + top small coder) ─────────
# Miranda brain: Qwen2.5-3B-Instruct abliterated (uncensored, always-on, free)
MIRANDA_MODEL="$VAULT/models/qwen-voice-agent/Qwen2.5-3B-Instruct-abliterated.Q4_K_M.gguf"
# Fallback path if named differently
if [ ! -f "$MIRANDA_MODEL" ]; then
  MIRANDA_MODEL="$(find "$VAULT/models" -name "*3B*abliterated*.gguf" -o -name "*3b*abliterated*.gguf" 2>/dev/null | head -1)"
fi

# Coding model: Qwen2.5-Coder-7B (best small coder, on burst port 8001)
CODER_MODEL="$VAULT/models/qwen-coder/Qwen2.5-Coder-7B-Instruct.Q4_K_M.gguf"
if [ ! -f "$CODER_MODEL" ]; then
  CODER_MODEL="$(find "$VAULT/models" -name "*Coder*7B*.gguf" -o -name "*coder*7b*.gguf" 2>/dev/null | head -1)"
fi

# Parakeet ASR: 110M TDT CTC (speech-to-text, Phase 2)
PARAKEET_MODEL="$VAULT/models/parakeet-110m/tdt_ctc-110m-q8_0.gguf"

# llama-server binary (from llama.cpp)
LLAMA_SERVER="${LLAMA_SERVER:-$(command -v llama-server 2>/dev/null || echo "$VAULT/bin/llama-server")}"

PIDS=()

cleanup() {
  echo ""
  echo "Shutting down CRANE..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  exit 0
}
trap cleanup EXIT INT TERM

# ── Ensure directories ────────────────────────────────────────────────────────
mkdir -p "$CRANE_HOME/.crane" "$CRANE_HOME/.miranda"

# ── Miranda 3B voice brain (port 8003) ───────────────────────────────────────
start_miranda() {
  if [ ! -f "$MIRANDA_MODEL" ]; then
    echo "⚠  Miranda model not found at $MIRANDA_MODEL"
    echo "   Run: bash scripts/download-models.sh to pull Qwen2.5-3B-abliterated"
    return 1
  fi
  if [ ! -x "$LLAMA_SERVER" ]; then
    echo "⚠  llama-server not found. Install llama.cpp or set LLAMA_SERVER= path."
    return 1
  fi
  echo "Starting Miranda (Qwen2.5-3B abliterated) on port $MIRANDA_PORT..."
  "$LLAMA_SERVER" \
    --model "$MIRANDA_MODEL" \
    --port "$MIRANDA_PORT" \
    --host 127.0.0.1 \
    --ctx-size 4096 \
    --n-gpu-layers 99 \
    --threads 4 \
    > "$CRANE_HOME/.miranda/miranda.log" 2>&1 &
  PIDS+=($!)
  echo "  Miranda PID: ${PIDS[-1]}"
}

# ── CRANE backend (port 8002) ─────────────────────────────────────────────────
start_backend() {
  BACKEND_BIN="$SCRIPT_DIR/target/release/crane-backend"
  if [ ! -f "$BACKEND_BIN" ]; then
    echo "Building CRANE backend (first run, takes ~30s)..."
    cargo build --release -p crane-backend 2>&1 | grep -E "Compiling|Finished|error"
  fi
  echo "Starting CRANE backend on port $BACKEND_PORT..."
  CRANE_HOME="$CRANE_HOME" CRANE_BACKEND_PORT="$BACKEND_PORT" "$BACKEND_BIN" \
    > "$CRANE_HOME/.crane/backend.log" 2>&1 &
  PIDS+=($!)
  echo "  Backend PID: ${PIDS[-1]}"
  sleep 1
}

# ── Main ──────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║        CRANE — Sovereign IDE                 ║"
echo "║        Miranda Voice Agent Loading...        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "CRANE_HOME: $CRANE_HOME"
echo "VAULT:      $VAULT"
echo ""

start_miranda
start_backend

sleep 2

# Health check
echo ""
echo "Service status:"
for port_name in "8002:Backend" "8003:Miranda-3B"; do
  port="${port_name%%:*}"
  name="${port_name##*:}"
  if curl -s "http://127.0.0.1:$port/health" > /dev/null 2>&1; then
    echo "  ✅ $name (port $port)"
  else
    echo "  ⚠  $name (port $port) — not yet responding (may still be loading)"
  fi
done

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  CRANE is running. Open the app or visit:    ║"
echo "║  http://localhost:$BACKEND_PORT/health               ║"
echo "║                                              ║"
echo "║  Logs: $CRANE_HOME/.crane/backend.log"
echo "║  Press Ctrl+C to stop all services           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

wait
