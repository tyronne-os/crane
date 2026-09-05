#!/bin/bash
# ── CRANE — AUTOMATIC1111 Setup for local image generation ───────────────────
# Installs A1111 at ~/stable-diffusion-webui and links your vault models.
# After this, run: cd ~/stable-diffusion-webui && ./webui.sh --api --listen

set -e

VAULT="${NOBILITY_VAULT:-/mnt/NOBILITY_VAULT}"
A1111_DIR="$HOME/stable-diffusion-webui"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    CRANE — AUTOMATIC1111 Setup               ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Check prerequisites ────────────────────────────────────────────────────────
echo "── Checking prerequisites ────────────────────────────────────────────────"
for cmd in git python3 pip3 wget; do
  if command -v $cmd &>/dev/null; then
    echo "  ✅ $cmd found"
  else
    echo "  ❌ $cmd not found — install it first"
    exit 1
  fi
done

# ── GPU check ─────────────────────────────────────────────────────────────────
if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
  GPU=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)
  echo "  ✅ GPU: $GPU"
else
  echo "  ⚠  No GPU detected — image generation will use CPU (very slow)"
fi
echo ""

# ── Clone AUTOMATIC1111 ────────────────────────────────────────────────────────
echo "── Installing AUTOMATIC1111 ──────────────────────────────────────────────"
if [ -d "$A1111_DIR" ]; then
  echo "  Already installed at $A1111_DIR"
  echo "  Pulling latest updates..."
  git -C "$A1111_DIR" pull --ff-only 2>&1 | tail -3
else
  echo "  Cloning stable-diffusion-webui..."
  git clone --depth 1 https://github.com/AUTOMATIC1111/stable-diffusion-webui.git "$A1111_DIR"
  echo "  ✅ Cloned to $A1111_DIR"
fi
echo ""

# ── Link vault models into A1111 models directory ─────────────────────────────
echo "── Linking vault models into A1111 ──────────────────────────────────────"
mkdir -p "$A1111_DIR/models/Stable-diffusion"
mkdir -p "$A1111_DIR/models/VAE"
mkdir -p "$A1111_DIR/models/Lora"

# Link .safetensors and .ckpt files from vault
linked=0
for ext in "safetensors" "ckpt"; do
  while IFS= read -r -d '' model_file; do
    basename=$(basename "$model_file")
    link_path="$A1111_DIR/models/Stable-diffusion/$basename"
    if [ ! -e "$link_path" ]; then
      ln -sf "$model_file" "$link_path"
      echo "  🔗 Linked: $basename"
      ((linked++)) || true
    else
      echo "  ✅ Already linked: $basename"
    fi
  done < <(find "$VAULT" -iname "*.$ext" -print0 2>/dev/null)
done

if [ $linked -eq 0 ]; then
  echo "  No new models to link."
fi

# Also link kokoro .pth if present (for TTS, not diffusion — just for reference)
KOKORO_PTH=$(find "$VAULT" -name "*.pth" 2>/dev/null | head -1)
if [ -n "$KOKORO_PTH" ]; then
  echo "  ℹ  Kokoro .pth found at: $KOKORO_PTH"
  echo "     (TTS model — not a diffusion model, handled separately)"
fi
echo ""

# ── Create a launcher shortcut ─────────────────────────────────────────────────
echo "── Creating launcher ─────────────────────────────────────────────────────"
LAUNCHER="$HOME/.local/bin/a1111"
mkdir -p "$HOME/.local/bin"
cat > "$LAUNCHER" <<LAUNCHER_SCRIPT
#!/bin/bash
# Start AUTOMATIC1111 with API enabled for CRANE Images integration
cd "$A1111_DIR"
exec ./webui.sh --api --listen --port 7860 "\$@"
LAUNCHER_SCRIPT
chmod +x "$LAUNCHER"
echo "  ✅ Launcher: ~/.local/bin/a1111"
echo "     Run: a1111    (starts on port 7860, CRANE will auto-connect)"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "── Done ──────────────────────────────────────────────────────────────────"
echo ""
echo "  Next steps:"
echo "  1. In one terminal:    a1111"
echo "     (first run downloads PyTorch + deps, ~5 min)"
echo ""
echo "  2. Once A1111 is up:   ./crane/run.sh"
echo ""
echo "  3. Open CRANE → click  🎨 Images → Generate"
echo ""
echo "  Or test A1111 API:    curl http://127.0.0.1:7860/sdapi/v1/sd-models"
echo ""
