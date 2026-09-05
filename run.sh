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

# llama-server binary (from llama.cpp or llama-cpp-python)
# Resolution order:
#   1. Explicit LLAMA_SERVER env var
#   2. llama-server on PATH (llama.cpp native build or apt package)
#   3. ~/.local/bin/llama-server (pip --user install)
#   4. $VAULT/bin/llama-server (manual install to vault)
#   5. python3 -m llama_cpp.server wrapper (llama-cpp-python pip package)
_find_llama_server() {
  command -v llama-server 2>/dev/null && return
  [ -x "$HOME/.local/bin/llama-server" ] && echo "$HOME/.local/bin/llama-server" && return
  [ -x "$VAULT/bin/llama-server" ] && echo "$VAULT/bin/llama-server" && return
  if python3 -c "import llama_cpp" 2>/dev/null; then
    # llama-cpp-python is installed; create a thin wrapper so run.sh can exec it
    WRAPPER="$VAULT/bin/llama-server"
    mkdir -p "$VAULT/bin"
    cat > "$WRAPPER" <<'WRAPPER_SCRIPT'
#!/bin/bash
exec python3 -m llama_cpp.server "$@"
WRAPPER_SCRIPT
    chmod +x "$WRAPPER"
    echo "$WRAPPER"
    return
  fi
  echo ""
}
LLAMA_SERVER="${LLAMA_SERVER:-$(_find_llama_server)}"

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
    echo "   Files there: $(ls "$VAULT/models/qwen-voice-agent/" 2>/dev/null | tr '\n' ' ' || echo '(none)')"
    echo ""
    echo "   If your model is not GGUF format, download the GGUF version (1.8GB):"
    echo "   cd $VAULT/models/qwen-voice-agent && \\"
    echo "   wget 'https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf'"
    echo ""
    echo "   Or run: scripts/install-inference.sh  (handles model + llama-server)"
    return 1
  fi
  if [ ! -x "$LLAMA_SERVER" ]; then
    echo "⚠  llama-server not found."
    echo "   Fix: run scripts/install-inference.sh (builds llama.cpp with CUDA)"
    echo "   Or:  export LLAMA_SERVER=/path/to/your/llama-server"
    echo ""
    echo "   ➜  Miranda will use browser SpeechRecognition/Synthesis as fallback."
    echo "      You can still talk to Miranda via the app — just without local LLM."
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
  # kokoro-fastapi works with .pth (PyTorch) models — preferred over piper/llama
  # Resolution: kokoro-serve CLI → python3 -m kokoro_fastapi → ~/.local/bin/kokoro-serve → piper
  local kokoro_bin=""
  if command -v kokoro-serve &>/dev/null; then
    kokoro_bin="$(command -v kokoro-serve)"
  elif [ -x "$HOME/.local/bin/kokoro-serve" ]; then
    kokoro_bin="$HOME/.local/bin/kokoro-serve"
  elif python3 -c "import kokoro_fastapi" 2>/dev/null; then
    # Create a wrapper
    mkdir -p "$VAULT/bin"
    cat > "$VAULT/bin/kokoro-serve" <<'KOK'
#!/bin/bash
exec python3 -m kokoro_fastapi "$@"
KOK
    chmod +x "$VAULT/bin/kokoro-serve"
    kokoro_bin="$VAULT/bin/kokoro-serve"
  fi

  if [ -n "$kokoro_bin" ]; then
    echo "Starting Kokoro TTS on port $TTS_PORT..."
    # kokoro-fastapi accepts model path via env; .pth or safetensors both work
    KOKORO_MODEL_PATH="${TTS_MODEL:-}" "$kokoro_bin" --host 127.0.0.1 --port "$TTS_PORT" \
      > "$CRANE_HOME/.crane/tts.log" 2>&1 &
    PIDS+=($!)
    echo "  TTS PID: ${PIDS[-1]}"
    return 0
  fi

  # Try piper as fallback (only works with piper-native .onnx models, not .pth)
  if command -v piper &>/dev/null; then
    if [ -n "$TTS_MODEL" ] && [ -f "$TTS_MODEL" ]; then
      echo "Starting Piper TTS on port $TTS_PORT..."
      piper --model "$TTS_MODEL" --port "$TTS_PORT" \
        > "$CRANE_HOME/.crane/tts.log" 2>&1 &
      PIDS+=($!)
      echo "  TTS PID: ${PIDS[-1]}"
      return 0
    fi
  fi

  echo "⚠  No TTS server (kokoro-serve, piper). Install: pip3 install kokoro-fastapi --break-system-packages"
  echo "   Browser SpeechSynthesis fallback is active — voice still works."
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
