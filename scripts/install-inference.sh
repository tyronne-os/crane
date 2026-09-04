#!/bin/bash
# ── CRANE Inference Setup ──────────────────────────────────────────────────────
# Installs llama-server (llama.cpp) so Miranda's 3B brain can run locally.
# Run this once on your machine, then re-run ./run.sh.
#
# Usage:
#   chmod +x scripts/install-inference.sh
#   ./scripts/install-inference.sh
set -e

VAULT="${NOBILITY_VAULT:-/mnt/NOBILITY_VAULT}"
BIN_DIR="$VAULT/bin"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    CRANE — Inference Server Setup            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Step 1: Check what model files exist ──────────────────────────────────────
echo "── Scanning NOBILITY_VAULT model directories ────────────────────────────"
echo ""

check_dir() {
  local dir="$1" label="$2"
  echo "[$label]  $dir"
  if [ -d "$dir" ]; then
    ls -lh "$dir" 2>/dev/null | grep -v "^total" | awk '{printf "  %-12s %s\n", $5, $NF}'
  else
    echo "  (directory not found)"
  fi
  echo ""
}

check_dir "$VAULT/models/qwen-voice-agent"  "Miranda 3B"
check_dir "$VAULT/models/qwen-coder-1.5b-local" "Coder 1.5B"
check_dir "$VAULT/models/parakeet-110m"     "Parakeet ASR"
check_dir "$VAULT/models/kokoro-82m"        "Kokoro TTS"
check_dir "$VAULT/models/vibevoice-1.5b"    "VibeVoice TTS"

# ── Step 2: Check if llama-server is already available ───────────────────────
echo "── Checking for llama-server ─────────────────────────────────────────────"
echo ""
if command -v llama-server &>/dev/null; then
  echo "  ✅ llama-server found at: $(which llama-server)"
  echo "     Version: $(llama-server --version 2>/dev/null | head -1 || echo 'unknown')"
  echo ""
  echo "  Nothing to install. Run ./run.sh to start CRANE."
  exit 0
fi

if [ -x "$BIN_DIR/llama-server" ]; then
  echo "  ✅ llama-server found at: $BIN_DIR/llama-server"
  echo "  Add it to PATH: export PATH=\"\$PATH:$BIN_DIR\""
  echo ""
  echo "  Run ./run.sh to start CRANE (it checks $BIN_DIR automatically)."
  exit 0
fi

echo "  ⚠  llama-server not found. Installing now..."
echo ""

# ── Step 3: Detect GPU and OS ─────────────────────────────────────────────────
ARCH=$(uname -m)
OS=$(uname -s)
HAS_CUDA=false
HAS_ROCM=false

if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
  HAS_CUDA=true
  GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
  echo "  GPU detected: $GPU_NAME (CUDA)"
elif command -v rocm-smi &>/dev/null; then
  HAS_ROCM=true
  echo "  GPU detected: AMD (ROCm)"
else
  echo "  No GPU detected — CPU inference will be slower but works"
fi

# ── Step 4: Install via the fastest available method ──────────────────────────
mkdir -p "$BIN_DIR"

install_via_build() {
  echo ""
  echo "── Building llama.cpp from source ───────────────────────────────────────"
  echo "  This takes 3-10 minutes. Grab a coffee."
  echo ""

  BUILD_DIR="$(mktemp -d)"
  git clone --depth 1 https://github.com/ggerganov/llama.cpp "$BUILD_DIR" 2>&1 | tail -3

  CMAKE_ARGS="-DCMAKE_BUILD_TYPE=Release"
  if $HAS_CUDA; then
    CMAKE_ARGS="$CMAKE_ARGS -DGGML_CUDA=ON"
    echo "  Building with CUDA support..."
  elif $HAS_ROCM; then
    CMAKE_ARGS="$CMAKE_ARGS -DGGML_HIPBLAS=ON"
    echo "  Building with ROCm/HIP support..."
  else
    echo "  Building CPU-only..."
  fi

  cmake "$BUILD_DIR" -B "$BUILD_DIR/build" $CMAKE_ARGS -DLLAMA_BUILD_SERVER=ON 2>&1 | tail -5
  cmake --build "$BUILD_DIR/build" --target llama-server -j$(nproc) 2>&1 | tail -5

  cp "$BUILD_DIR/build/bin/llama-server" "$BIN_DIR/llama-server"
  chmod +x "$BIN_DIR/llama-server"
  rm -rf "$BUILD_DIR"

  echo "  ✅ llama-server installed to $BIN_DIR/llama-server"
}

# Try pip install first (faster than build)
if command -v pip3 &>/dev/null || command -v pip &>/dev/null; then
  PIP=$(command -v pip3 || command -v pip)
  echo "── Trying llama-cpp-python (pip) ────────────────────────────────────────"
  if $HAS_CUDA; then
    CMAKE_ARGS="-DGGML_CUDA=on" pip install llama-cpp-python[server] --quiet 2>&1 | tail -3 && \
      echo "  ✅ Installed llama-cpp-python with CUDA" && \
      echo "  llama-server is now available via: python -m llama_cpp.server" && \
      cat >> "$VAULT/bin/llama-server-wrapper.sh" <<'WRAPPER'
#!/bin/bash
exec python3 -m llama_cpp.server "$@"
WRAPPER
      chmod +x "$VAULT/bin/llama-server-wrapper.sh" && \
      ln -sf "$VAULT/bin/llama-server-wrapper.sh" "$BIN_DIR/llama-server" && \
      echo "  Symlink created: $BIN_DIR/llama-server → wrapper" || install_via_build
  else
    pip install llama-cpp-python[server] --quiet 2>&1 | tail -3 && \
      echo "  ✅ Installed llama-cpp-python (CPU)" || install_via_build
  fi
else
  install_via_build
fi

# ── Step 5: Verify model formats ──────────────────────────────────────────────
echo ""
echo "── Checking model formats ────────────────────────────────────────────────"
echo ""

MIRANDA_MODEL=$(find "$VAULT/models/qwen-voice-agent" -iname "*.gguf" 2>/dev/null | head -1)

if [ -z "$MIRANDA_MODEL" ]; then
  echo "  ⚠  No .gguf file found in $VAULT/models/qwen-voice-agent/"
  echo ""
  echo "  Files found there:"
  ls -lh "$VAULT/models/qwen-voice-agent/" 2>/dev/null || echo "  (directory empty or missing)"
  echo ""
  echo "  Miranda needs a Qwen2.5-3B model in GGUF format."
  echo "  Quick download (1.8GB) — run this:"
  echo ""
  echo "    mkdir -p $VAULT/models/qwen-voice-agent"
  echo "    cd $VAULT/models/qwen-voice-agent"
  echo "    wget 'https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf'"
  echo ""
  echo "  (Q4_K_M = 1.8GB, best quality/size ratio for 3B)"
else
  echo "  ✅ Miranda model: $(basename "$MIRANDA_MODEL") ($(du -sh "$MIRANDA_MODEL" | cut -f1))"
fi

echo ""
echo "── Done ──────────────────────────────────────────────────────────────────"
echo ""
echo "  Next steps:"
if [ -z "$MIRANDA_MODEL" ]; then
  echo "  1. Download the GGUF model (command above)"
  echo "  2. Run: ./run.sh"
else
  echo "  1. Run: ./run.sh"
fi
echo "  2. Open: http://localhost:8002"
echo "  3. Click 🎤 Speak in the Miranda panel and talk to her"
echo ""
