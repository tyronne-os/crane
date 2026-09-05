#!/bin/bash
# ── Quick fix: get llama-server running for Miranda's 3B brain ────────────────
# Run this when ./run.sh says "llama-server not found"
set -e

VAULT="${NOBILITY_VAULT:-/mnt/NOBILITY_VAULT}"
LOCAL_BIN="$HOME/.local/bin"
VAULT_BIN="$VAULT/bin"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    CRANE — llama-server Quick Fix            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Step 1: Check if llama_cpp Python module is already installed ──────────────
echo "── Checking for existing llama_cpp install ───────────────────────────────"
if python3 -c "import llama_cpp" 2>/dev/null; then
  echo "  ✅ llama_cpp Python module found — creating wrapper..."
  mkdir -p "$LOCAL_BIN"
  cat > "$LOCAL_BIN/llama-server" <<'WRAPPER'
#!/bin/bash
exec python3 -m llama_cpp.server "$@"
WRAPPER
  chmod +x "$LOCAL_BIN/llama-server"
  echo "  ✅ Wrapper created: $LOCAL_BIN/llama-server"
  echo "     (makes sure ~/.local/bin is on PATH — add to ~/.bashrc if not there)"
  export PATH="$PATH:$LOCAL_BIN"
  echo ""
else
  # ── Step 2: Install llama-cpp-python ──────────────────────────────────────
  echo "  llama_cpp not found — installing..."
  echo ""

  # Detect GPU
  HAS_CUDA=false
  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
    HAS_CUDA=true
    GPU=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
    echo "  GPU detected: $GPU"
  else
    echo "  No GPU detected (or nvidia-smi not found) — installing CPU build"
    echo "  For GPU support after this: CMAKE_ARGS=\"-DGGML_CUDA=on\" pip3 install llama-cpp-python[server] --break-system-packages --force-reinstall"
  fi

  CMAKE_ARGS=""
  if $HAS_CUDA; then
    CMAKE_ARGS="-DGGML_CUDA=on"
    echo "  Building with CUDA..."
  fi

  pip_installed=false
  for flags in "--break-system-packages" "--user"; do
    echo "  Trying: pip3 install llama-cpp-python[server] $flags"
    if CMAKE_ARGS="$CMAKE_ARGS" pip3 install "llama-cpp-python[server]" $flags -q 2>&1; then
      pip_installed=true
      echo "  ✅ pip install succeeded ($flags)"
      break
    else
      echo "  ⚠  $flags failed, trying next..."
    fi
  done

  if ! $pip_installed; then
    echo ""
    echo "  ❌ pip install failed. Try manually:"
    echo "     CMAKE_ARGS=\"-DGGML_CUDA=on\" pip3 install llama-cpp-python[server] --break-system-packages"
    exit 1
  fi

  mkdir -p "$LOCAL_BIN"
  cat > "$LOCAL_BIN/llama-server" <<'WRAPPER'
#!/bin/bash
exec python3 -m llama_cpp.server "$@"
WRAPPER
  chmod +x "$LOCAL_BIN/llama-server"
  echo "  ✅ Wrapper created: $LOCAL_BIN/llama-server"
  export PATH="$PATH:$LOCAL_BIN"
fi

# ── Step 3: Add ~/.local/bin to PATH permanently ───────────────────────────────
echo ""
echo "── Ensuring ~/.local/bin is in PATH ─────────────────────────────────────"
BASHRC="$HOME/.bashrc"
if ! grep -q "\.local/bin" "$BASHRC" 2>/dev/null; then
  echo 'export PATH="$PATH:$HOME/.local/bin"' >> "$BASHRC"
  echo "  ✅ Added to ~/.bashrc"
else
  echo "  ✅ Already in ~/.bashrc"
fi

# ── Step 4: Find Miranda model ─────────────────────────────────────────────────
echo ""
echo "── Finding Miranda model ─────────────────────────────────────────────────"
MIRANDA_MODEL=$(find "$VAULT/models/qwen-voice-agent" -iname "*.gguf" 2>/dev/null | head -1)
if [ -z "$MIRANDA_MODEL" ]; then
  echo "  ⚠  No GGUF found in $VAULT/models/qwen-voice-agent/"
  echo "     Check: ls -la $VAULT/models/qwen-voice-agent/"
  exit 1
fi
echo "  ✅ Model: $(basename "$MIRANDA_MODEL")"

# ── Step 5: Start Miranda's brain on port 8003 ────────────────────────────────
echo ""
echo "── Starting Miranda brain on port 8003 ──────────────────────────────────"

# Kill any existing instance on 8003
fuser -k 8003/tcp 2>/dev/null || true
sleep 0.5

CRANE_HOME="${CRANE_HOME:-$HOME/crane-projects}"
mkdir -p "$CRANE_HOME/.miranda"

LOG="$CRANE_HOME/.miranda/miranda.log"
"$LOCAL_BIN/llama-server" \
  --model "$MIRANDA_MODEL" \
  --port 8003 \
  --host 127.0.0.1 \
  --ctx-size 4096 \
  --n-gpu-layers 99 \
  --threads 4 \
  > "$LOG" 2>&1 &
MIRANDA_PID=$!
echo "  Miranda PID: $MIRANDA_PID"
echo "  Log: $LOG"

echo ""
echo "── Waiting for Miranda to load model (up to 30s)... ─────────────────────"
for i in $(seq 1 30); do
  sleep 1
  if curl -s "http://127.0.0.1:8003/v1/models" >/dev/null 2>&1; then
    echo ""
    echo "  ✅ Miranda is live on port 8003!"
    break
  fi
  printf "."
  if [ $i -eq 30 ]; then
    echo ""
    echo "  ⚠  Still loading — model may take longer with CPU inference."
    echo "     Check logs: tail -f $LOG"
  fi
done

echo ""
echo "── Done ──────────────────────────────────────────────────────────────────"
echo ""
echo "  Miranda brain is running. Now start (or restart) CRANE:"
echo "    ./run.sh"
echo ""
echo "  Or check status:"
echo "    curl http://127.0.0.1:8003/v1/models"
echo ""
