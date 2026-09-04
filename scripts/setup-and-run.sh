#!/bin/bash
# CRANE self-activating setup — finds or clones the repo, checks out the
# Miranda branch, verifies/downloads models, and launches everything.
# Safe to re-run any time.
set -e

REPO_URL="https://github.com/tyronne-os/crane.git"
BRANCH="claude/voice-agent-ide-plan-oq1dpa"
VAULT="${NOBILITY_VAULT:-/mnt/NOBILITY_VAULT}"

echo ""
echo "=== CRANE Setup ==="
echo ""

# ── 1. Find or clone the repo ────────────────────────────────────────────────
CRANE_DIR="$(find "$HOME" -maxdepth 4 -type d -name "crane" 2>/dev/null | grep -v "/\." | head -1)"

if [ -n "$CRANE_DIR" ] && [ -d "$CRANE_DIR/.git" ]; then
  echo "[1/5] Found existing clone: $CRANE_DIR"
  cd "$CRANE_DIR"
else
  echo "[1/5] No local clone found. Cloning fresh into $HOME/crane..."
  git clone "$REPO_URL" "$HOME/crane"
  CRANE_DIR="$HOME/crane"
  cd "$CRANE_DIR"
fi

# ── 2. Checkout the Miranda branch ───────────────────────────────────────────
echo ""
echo "[2/5] Fetching and checking out $BRANCH..."
git fetch origin "$BRANCH"
if git rev-parse --verify "$BRANCH" &>/dev/null; then
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  git checkout -b "$BRANCH" "origin/$BRANCH"
fi

# ── 3. Check NOBILITY_VAULT for models ───────────────────────────────────────
echo ""
echo "[3/5] Checking models in $VAULT..."
if [ -d "$VAULT/models" ]; then
  ls "$VAULT/models/" 2>/dev/null || echo "  (empty)"
else
  echo "  ⚠  $VAULT not found — set NOBILITY_VAULT env var if it's mounted elsewhere"
fi

bash scripts/download-models.sh

# ── 4. Check llama-server ────────────────────────────────────────────────────
echo ""
echo "[4/5] Checking llama-server..."
if command -v llama-server &>/dev/null; then
  echo "  ✅ llama-server found: $(command -v llama-server)"
else
  echo "  ⚠  llama-server not found."
  if command -v brew &>/dev/null; then
    echo "  Installing via brew..."
    brew install llama.cpp
  else
    echo "  Install manually: https://github.com/ggerganov/llama.cpp#build"
    echo "  (or: pip install llama-cpp-python[server])"
  fi
fi

# ── 5. Launch ─────────────────────────────────────────────────────────────────
echo ""
echo "[5/5] Starting CRANE..."
echo ""
chmod +x ./run.sh
./run.sh
