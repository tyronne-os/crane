#!/bin/bash
# Verifies the models CRANE needs are already in NOBILITY_VAULT.
# Disk is 89% full (13GB free) — this does NOT download anything by default.
# Everything Miranda/coder need is already on disk per the confirmed inventory:
#   qwen-voice-agent (1.8GB)   — Miranda's brain, Qwen 2.5 3B abliterated
#   qwen-coder-1.5b-local (1.1GB) — coding model
#   parakeet-110m (170MB)      — ASR, Phase 2
#   vibevoice-1.5b (5.1GB)     — TTS, Phase 2
#   kokoro-82m (313MB)         — TTS fallback

VAULT="${NOBILITY_VAULT:-/mnt/NOBILITY_VAULT}"

echo ""
echo "=== CRANE Model Check ==="
echo "VAULT: $VAULT"
echo ""

check_model() {
  local name="$1" dir="$2"
  local found
  found="$(find "$dir" -iname "*.gguf" -o -iname "*.safetensors" -o -iname "*.bin" 2>/dev/null | head -1)"
  if [ -n "$found" ]; then
    echo "  ✅ $name: $found"
  else
    echo "  ⚠  $name: no model file found in $dir"
    echo "     ls -la $dir  (contents may need a different --iname pattern)"
  fi
}

check_model "Miranda brain (Qwen 2.5 3B abliterated)" "$VAULT/models/qwen-voice-agent"
check_model "Coder (qwen-coder-1.5b-local)"            "$VAULT/models/qwen-coder-1.5b-local"
check_model "Parakeet ASR (110m)"                       "$VAULT/models/parakeet-110m"
check_model "VibeVoice TTS (1.5b)"                      "$VAULT/models/vibevoice-1.5b"
check_model "Kokoro TTS fallback (82m)"                 "$VAULT/models/kokoro-82m"

echo ""
echo "Disk: $(df -h "$VAULT" 2>/dev/null | tail -1 | awk '{print $4" free of "$2" ("$5" used)"}')"
echo ""
echo "Everything above should already be present — this script does not"
echo "download by default since the vault is nearly full. If a model is"
echo "genuinely missing, download it manually and place it under the path shown."
echo ""
echo "Run ./run.sh to start CRANE."
