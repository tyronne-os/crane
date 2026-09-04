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

# ── Model paths (confirmed live inventory in NOBILITY_VAULT, 35.7GB / 7 models) ─
# Miranda brain: Qwen 2.5 3B abliterated, 1.8GB — models/qwen-voice-agent/
MIRANDA_MODEL="$(find "$VAULT/models/qwen-voice-agent" -iname "*.gguf" 2>/dev/null | head -1)"

# Coding model: qwen-coder-1.5b-local, 1.1GB — already on disk, no download needed
CODER_MODEL="$(find "$VAULT/models/qwen-coder-1.5b-local" -iname "*.gguf" 2>/dev/null | head -1)"

# Parakeet ASR: 110M, 170MB (Phase 2) — models/parakeet-110m/
PARAKEET_MODEL="$(find "$VAULT/models/parakeet-110m" -iname "*.gguf" 2>/dev/null | head -1)"

# TTS: VibeVoice 1.5B, 5.1GB, spec'd primary (Phase 2) — models/vibevoice-1.5b/
TTS_MODEL="$(find "$VAULT/models/vibevoice-1.5b" -iname "*.gguf" -o -iname "*.safetensors" -o -iname "*.bin" 2>/dev/null | head -1)"
# Fallback TTS: kokoro-82m, 313MB — models/kokoro-82m/
if [ -z "$TTS_MODEL" ]; then
  TTS_MODEL="$(find "$VAULT/models/kokoro-82m" -iname "*.gguf" -o -iname "*.safetensors" -o -iname "*.bin" 2>/dev/null | head -1)"
fi

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
  if [ -z "$MIRANDA_MODEL" ] || [ ! -f "$MIRANDA_MODEL" ]; then
    echo "⚠  No .gguf found under $VAULT/models/qwen-voice-agent/"
    echo "   You have 1.8GB there but it may not be GGUF format (check with:"
    echo "   ls -la $VAULT/models/qwen-voice-agent/)"
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

# ── Parakeet 110M ASR (port 8004, whisper.cpp server) ────────────────────────
start_parakeet() {
  if [ -z "$PARAKEET_MODEL" ] || [ ! -f "$PARAKEET_MODEL" ]; then
    echo "⚠  No Parakeet model found under $VAULT/models/parakeet-110m/"
    echo "   ASR will use browser SpeechRecognition fallback."
    return 1
  fi

  # Try whisper.cpp server (--port flag, same binary as llama-server on some builds)
  WHISPER_SERVER="${WHISPER_SERVER:-$(command -v whisper-server 2>/dev/null || echo "$VAULT/bin/whisper-server")}"
  if [ ! -x "$WHISPER_SERVER" ]; then
    # Some llama.cpp builds ship whisper support in llama-server itself
    WHISPER_SERVER="$LLAMA_SERVER"
  fi

  if [ ! -x "$WHISPER_SERVER" ]; then
    echo "⚠  No whisper-server binary. ASR browser fallback active."
    return 1
  fi

  echo "Starting Parakeet ASR on port $PARAKEET_PORT..."
  "$WHISPER_SERVER" \
    --model "$PARAKEET_MODEL" \
    --port "$PARAKEET_PORT" \
    --host 127.0.0.1 \
    > "$CRANE_HOME/.crane/parakeet.log" 2>&1 &
  PIDS+=($!)
  echo "  Parakeet PID: ${PIDS[-1]}"
}

# ── TTS server (port 8005) ────────────────────────────────────────────────────
start_tts() {
  if [ -z "$TTS_MODEL" ] || [ ! -f "$TTS_MODEL" ]; then
    echo "⚠  No TTS model found in vault. TTS will use browser SpeechSynthesis fallback."
    return 1
  fi

  # Try kokoro-fastapi (Python, OpenAI-compatible) if installed
  if command -v kokoro-serve &>/dev/null; then
    echo "Starting Kokoro TTS (kokoro-serve) on port $TTS_PORT..."
    KOKORO_MODEL="$TTS_MODEL" kokoro-serve --port "$TTS_PORT" --host 127.0.0.1 \
      > "$CRANE_HOME/.crane/tts.log" 2>&1 &
    PIDS+=($!)
    echo "  TTS PID: ${PIDS[-1]}"
    return 0
  fi

  # Try piper TTS if installed
  if command -v piper &>/dev/null; then
    echo "Starting Piper TTS on port $TTS_PORT..."
    piper --model "$TTS_MODEL" --port "$TTS_PORT" \
      > "$CRANE_HOME/.crane/tts.log" 2>&1 &
    PIDS+=($!)
    echo "  TTS PID: ${PIDS[-1]}"
    return 0
  fi

  echo "⚠  No TTS server binary (kokoro-serve, piper). Browser SpeechSynthesis fallback active."
  return 1
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

start_miranda || echo "  Miranda will be available once model is in GGUF format (check: ls -la $VAULT/models/qwen-voice-agent/)"
start_parakeet || true
start_tts || true
start_backend

sleep 2

# Health check
echo ""
echo "Service status:"
for port_name in "8002:Backend:/api/health" "8003:Miranda-3B:/v1/models" "8004:Parakeet-ASR:/health" "8005:TTS:/health"; do
  port="${port_name%%:*}"
  rest="${port_name#*:}"
  name="${rest%%:*}"
  path="${rest##*:}"
  if curl -s "http://127.0.0.1:$port$path" > /dev/null 2>&1; then
    echo "  ✅  $name (port $port)"
  else
    echo "  ⚠   $name (port $port) — not yet responding (may still be loading model)"
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
