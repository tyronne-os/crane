#!/bin/bash
# Downloads the best uncensored conversational + top small coding models
# to NOBILITY_VAULT (your local 100GB drive)

VAULT="${NOBILITY_VAULT:-/mnt/NOBILITY_VAULT}"

check_hf() {
  if ! command -v huggingface-cli &>/dev/null; then
    pip install -q huggingface_hub 2>/dev/null || true
  fi
}

download_gguf() {
  local repo="$1" file="$2" dest_dir="$3"
  mkdir -p "$dest_dir"
  local dest="$dest_dir/$file"
  if [ -f "$dest" ]; then
    echo "  Already have: $dest"
    return
  fi
  echo "  Downloading $file from $repo..."
  huggingface-cli download "$repo" "$file" --local-dir "$dest_dir" --local-dir-use-symlinks False
}

check_hf

echo ""
echo "=== CRANE Model Setup ==="
echo "VAULT: $VAULT"
echo ""

# ── Miranda voice brain: best uncensored 3B for conversation ──────────────────
echo "[1/2] Miranda brain — Qwen2.5-3B-Instruct abliterated (uncensored)"
echo "      Source: bartowski/Qwen2.5-3B-Instruct-abliterated-GGUF"
download_gguf \
  "bartowski/Qwen2.5-3B-Instruct-abliterated-GGUF" \
  "Qwen2.5-3B-Instruct-abliterated-Q4_K_M.gguf" \
  "$VAULT/models/qwen-voice-agent"

# ── Coding model: top small coder ────────────────────────────────────────────
echo ""
echo "[2/2] Coder — Qwen2.5-Coder-7B-Instruct Q4_K_M (best small coder)"
echo "      Source: Qwen/Qwen2.5-Coder-7B-Instruct-GGUF"
download_gguf \
  "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF" \
  "qwen2.5-coder-7b-instruct-q4_k_m.gguf" \
  "$VAULT/models/qwen-coder"

echo ""
echo "Done. Run ./run.sh to start CRANE."
