# Miranda Voice Agent — Tasks

## Phase 1: Model Downloads & Inference Servers

- [ ] 1. Download Phi-4 14B uncensored GGUF (speed + accuracy, no hallucination quant) [CAT 1]
  - HF repo: `bartowski/phi-4-GGUF`
  - File: `phi-4-Q6_K.gguf` (~12GB, Q6_K = near-lossless, best accuracy/speed tradeoff at this size)
  - Destination: `/mnt/NOBILITY_VAULT/models/phi-4/`
  - Command: `huggingface-cli download bartowski/phi-4-GGUF phi-4-Q6_K.gguf --local-dir /mnt/NOBILITY_VAULT/models/phi-4/`
  - Verify: byte count matches HF repo listing before marking done

- [ ] 2. Download GLM-4.7 Flash Uncensored Heretic GGUF (30B-A3B MoE, uncensored, coding-specialized) [CAT 1]
  - HF repo: `DavidAU/GLM-4.7-Flash-Uncensored-Heretic-NEO-CODE-Imatrix-MAX-GGUF`
  - File: largest Q4_K_M imatrix quant available (~8GB)
  - Destination: `/mnt/NOBILITY_VAULT/models/glm-4.7-heretic/`
  - Note: 30B total params, only ~3B active per token (MoE) — runs fast on CPU
  - Verify: byte count + test inference with one prompt before marking done

- [ ] 3. Download Gemma-3-27B abliterated GGUF (Google's best, fully uncensored via abliteration) [CAT 1]
  - HF repo: `bartowski/mlabonne_gemma-3-27b-it-abliterated-GGUF`
  - File: `mlabonne_gemma-3-27b-it-abliterated-Q4_K_M.gguf` (~17GB)
  - Destination: `/mnt/NOBILITY_VAULT/models/gemma-3-27b-abliterated/`
  - Note: abliterated = same technique used on Miranda's existing Qwen brain — no refusals
  - Verify: byte count + test inference before marking done

- [ ] 4. Download Nemotron-3.5 Lightning 30B-A3B GGUF (NVIDIA MoE, reasoning + agentic tasks) [CAT 1]
  - HF repo: `AtomicChat/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF`
  - File: best available Q4_K_M or AD-layout quant (~10GB)
  - Destination: `/mnt/NOBILITY_VAULT/models/nemotron-30b/`
  - Note: Hybrid Mamba-2/Transformer MoE. Pre-training cutoff: Sept 2025. ~3B active params/token.
  - Verify: byte count + test inference before marking done

- [ ] 5. Download LTX-2.5 video+audio diffusion model (open weights, local, MIT license) [CAT 1]
  - HF repo: `Lightricks/LTX-2.5-Diffusers`
  - Download all model weights to `/mnt/NOBILITY_VAULT/models/ltx-2.5/`
  - Command: `huggingface-cli download Lightricks/LTX-2.5-Diffusers --local-dir /mnt/NOBILITY_VAULT/models/ltx-2.5/`
  - Note: Generates synchronized audio+video from text/image prompt. Designed for on-device deployment. No cloud dependency.
  - Verify: confirm all shards downloaded, run one test generation

- [ ] 6. Download MiniMax H3 joint audio+video DiT model [CAT 1]
  - HF repo: `smhfacct/Minimax-H3-fl2va-ref2va-hybrid-models`
  - Destination: `/mnt/NOBILITY_VAULT/models/minimax-h3/`
  - Note: Alternative to LTX-2.5. Joint audio+video diffusion transformer. 1344×768 native canvas.
  - Verify: all shards present

---

## Phase 2: Model Agent Routing System

- [ ] 7. Create Miranda model agent router (Rust, `src/routes/miranda_models.rs`) [CAT 2]
  - Implement `ModelAgent` struct with fields: `id`, `name`, `description`, `model_path`, `port`, `capabilities: Vec<ModelCapability>`
  - `ModelCapability` enum: `Coding`, `Reasoning`, `General`, `Uncensored`, `Vision`, `VideoGeneration`, `AudioGeneration`
  - Implement `GET /api/miranda/models` — returns full registry of available local models with status (loaded/unloaded/downloading)
  - Implement `POST /api/miranda/models/select` — switch active inference model by id
  - Implement `POST /api/miranda/models/generate` — route to currently selected model's llama-server endpoint
  - Model registry (hardcoded, updated as models are downloaded):
    ```
    qwen-3b-abliterated   → localhost:8003  (default brain, already downloaded)
    phi-4-14b             → localhost:8005  (reasoning + coding)
    glm-4.7-heretic       → localhost:8006  (uncensored, MoE fast)
    gemma-3-27b           → localhost:8007  (Google reasoning, abliterated)
    nemotron-30b          → localhost:8008  (NVIDIA MoE, agentic)
    ```

- [ ] 8. Create llama-server launch scripts for each model (Bash, `scripts/start-model-*.sh`) [CAT 1]
  - One script per model, all follow same pattern:
    ```bash
    #!/usr/bin/env bash
    # start-model-phi4.sh
    podman run -d --name miranda-phi4 \
      -p 8005:8000 \
      -v /mnt/NOBILITY_VAULT/models/phi-4:/models:ro \
      llama-server-image \
      --model /models/phi-4-Q6_K.gguf \
      --host 0.0.0.0 --port 8000 \
      -c 16384 -t 4
    ```
  - Scripts: `start-model-qwen3b.sh`, `start-model-phi4.sh`, `start-model-glm47.sh`, `start-model-gemma3.sh`, `start-model-nemotron.sh`
  - All rootless Podman, volume-mount model files read-only
  - Include health check: poll `GET /health` until 200 before returning

- [ ] 9. Create LTX-2.5 video generation server (Python, `scripts/ltx-server.py`) [CAT 2]
  - Python FastAPI wrapper around `Lightricks/LTX-2.5-Diffusers`
  - Route: `POST /generate` — input: `{prompt, duration_seconds, resolution, audio: bool}`
  - Output: stream MP4 file (or return path to generated file)
  - Runs on `localhost:8009`
  - No content filters — pass prompt directly to diffusion pipeline
  - Launch via Podman: `podman run -d --name miranda-ltx -p 8009:8009 -v /mnt/NOBILITY_VAULT/models/ltx-2.5:/models:ro miranda-ltx-image`

---

## Phase 3: Composer UI (CRANE Frontend)

- [ ] 10. Design and implement Composer toolbar component (`frontend-static/components/Composer.jsx`) [CAT 2]
  - Mirrors Kiro/Claude composer layout: single bottom bar with model selector, tool toggles, and action icons
  - **Left side**: Model selector dropdown (all local models listed with icons)
  - **Center**: Text/voice input area (replaces keyboard input with Miranda voice by default)
  - **Right side**: Tool icon row + Send button
  - Model selector dropdown items (each with custom icon):
    - 🧠 Miranda Core (Qwen 3B) — default
    - ⚡ Phi-4 (Microsoft, reasoning)
    - 🔥 GLM-4.7 Heretic (uncensored, fast)
    - 💎 Gemma-3-27B (Google, deep reasoning)
    - 🚀 Nemotron-30B (NVIDIA, agentic)
    - 🎬 LTX-2.5 Video+Audio
    - 🎥 MiniMax H3 Video+Audio
  - All models show local status badge: green dot (loaded) / grey dot (available) / spinner (loading)

- [ ] 11. Implement tool icon row in Composer [CAT 2]
  - Tool icons displayed left-to-right in composer right section:
    - 📎 Attach file (opens file picker → `/api/file/read`)
    - 🖼️ Generate image (routes to diffusion model if loaded)
    - 🎬 Generate video (routes to LTX-2.5 or MiniMax H3)
    - 🔧 Run shell (executes scoped shell command via `/api/shell`)
    - 📦 New project (triggers project creation flow)
    - 🐙 GitHub (push/create repo)
    - 🐳 Podman (spin up/stop containers)
    - 📚 Memory (open memory browser overlay)
  - Each icon is a 24×24px SVG button, tooltip on hover, disabled state when model not loaded
  - Icons use consistent dark-theme style matching CRANE's existing UI palette

- [ ] 12. Implement model status polling + auto-start [CAT 2]
  - Frontend polls `GET /api/miranda/models` every 5 seconds
  - If selected model shows `unloaded`: display "Starting model..." badge, call `POST /api/miranda/models/select` to launch it
  - Show loading spinner on model dropdown item while starting
  - On load complete: green dot, remove spinner
  - If startup fails after 30s: red dot + tooltip showing error from server logs

- [ ] 13. Wire Composer model selector to backend routing [CAT 3]
  - On model selection change in UI: `POST /api/miranda/models/select {model_id}`
  - Backend stops old llama-server Podman container, starts new one (or keeps running if already up)
  - All subsequent `POST /api/miranda/generate` calls routed to newly selected model port
  - Maintain one active LLM model at a time (memory constraint) — video models (LTX-2.5, MiniMax H3) can run concurrently since they use separate GPU/CPU pipeline

---

## Phase 4: Voice Panel + Memory (existing Miranda requirements)

- [ ] 14. Build MirandaVoicePanel React component (`frontend-static/components/MirandaVoicePanel.jsx`) [CAT 2]
  - Left sidebar bottom section
  - States: Listening (blue waveform) / Processing (pulse) / Speaking (gold waveform)
  - VAD auto-trigger + manual record button fallback
  - Live transcript scroll + Miranda response streaming
  - Memory recall indicator (shows session reference if prior context used)

- [ ] 15. Implement VAD + Parakeet ASR backend route (`POST /api/miranda/transcribe`) [CAT 3]
  - WebSocket endpoint: accepts 400ms audio chunks (base64-encoded PCM 16kHz mono)
  - VAD: energy threshold + zero-crossing rate analysis
  - On speech detected: forward to Parakeet server at localhost:8002
  - Return interim + final transcript events over WebSocket

- [ ] 16. Implement persona injection + Qwen generate route (`POST /api/miranda/generate`) [CAT 2]
  - Load Miranda persona system prompt (from design.md template)
  - Search memory JSONL for relevant prior context (top 3 matches by TF-IDF relevance)
  - Inject context + persona + current project into prompt
  - Forward to active model server (default: Qwen 3B)
  - Stream SSE token events back to frontend

- [ ] 17. Implement TTS route (`POST /api/miranda/speak`) [CAT 2]
  - Input: response text + locked voice_profile (mature_35, pitch 0.88, confident_warm)
  - Forward to VibeVoice server at localhost:8004 with locked params — no user override for gender/age
  - Stream WAV/MP3 chunks to frontend
  - Frontend plays via Web Audio API

- [ ] 18. Implement persistent memory (JSONL log + search) [CAT 2]
  - On session end: append turn to `/mnt/NOBILITY_VAULT/.miranda/memory.jsonl`
  - `GET /api/miranda/memory/search?q=<query>`: full-text + tag search, return top 3 matches with relevance score
  - Memory struct: `{session_id, timestamp, user_query, miranda_response, tags, metadata}`
  - Tags auto-extracted from response (topic keywords, project names, tool calls used)

---

## Phase 5: Integration & End-to-End Test

- [ ] 19. Wire all components together + run.sh update [CAT 2]
  - Update `run.sh` to start: Parakeet ASR server (8002), Qwen LLM server (8003), VibeVoice TTS server (8004), CRANE backend (5173)
  - All model servers started as Podman containers with health checks
  - CRANE backend starts only after all inference servers respond healthy

- [ ] 20. End-to-end voice test [CAT 3]
  - Speak: "Create a new Rust project called beryltest"
  - Verify: Parakeet transcribes correctly, Qwen generates response, VibeVoice speaks it back, memory.jsonl entry appended
  - Verify latency: transcript available <500ms, first TTS audio chunk <500ms, full response <3s on CPU
  - Verify no internet required: run with ethernet disconnected

- [ ] 21. Commit all changes to GitHub and push [CAT 1]
  - `git add -A && git commit -m "feat: Miranda voice agent + model composer UI"`
  - Push to `tyronne-os/crane` master

---

## Phase 6: Intelligent Model Orchestration (Microsoft Agent Framework + BitNet + GPU Manager)

- [ ] 22. Install and configure Microsoft Agent Framework (MAF 1.0) as the model orchestration backbone [CAT 2]
  - Install: `pip install microsoft-agent-framework` (MAF 1.0 GA — unified AutoGen + Semantic Kernel)
  - Create `scripts/maf/orchestrator.py` — the central MAF agent that owns ALL model lifecycle decisions
  - MAF agent responsibilities:
    - Receive task context from CRANE backend (task type, estimated token load, current GPU state)
    - Decide: which model to use, which backend (llama.cpp / vLLM / AirLLM / BitNet.cpp), which quant tier
    - Decide: whether to wake GCP GPU ($0.40/hr), stay on CPU, or use BitNet for CPU-only
    - Issue commands back to CRANE backend via `POST /api/maf/command`
  - MAF runs as a persistent Podman sidecar: `podman run -d --name miranda-maf -p 8010:8010 miranda-maf-image`

- [ ] 23. Implement GPU cost manager with 15-minute sleep timer [CAT 2]
  - Create `scripts/maf/gpu_manager.py` — tracks GPU state and enforces cost rules
  - GPU state machine: `SLEEPING → WAKING → ACTIVE → IDLE → SLEEPING`
  - On model selection requiring GPU: wake GCP Compute Engine instance via GCP SDK (`google-cloud-compute`)
  - Start 15-minute inactivity timer on every inference completion
  - On timer expiry with no new requests: gracefully stop GPU instance (cost = $0)
  - Cost thresholds (enforced by MAF, never bypassed):
    - Models ≤ 8GB VRAM footprint → CPU-only by default (no GPU spin-up)
    - Models 8–20GB → $0.40/hr GPU auto-wake, user notified via UI banner: "GPU active · $0.40/hr · 15min idle shutoff"
    - Models > 20GB → MAF suggests smaller quantization first; GPU only if quality score degrades >5%
  - GCP instance type: `n1-standard-4` + `NVIDIA T4` (16GB VRAM, ~$0.40/hr preemptible)
  - All GPU costs displayed live in CRANE header bar: "☁️ GPU: ACTIVE · $0.003 used · 8min remaining"

- [ ] 24. Implement BitNet.cpp integration for CPU-only large model inference [CAT 2]
  - Clone and build `microsoft/BitNet` from source in `/mnt/NOBILITY_VAULT/tools/bitnet/`
  - Build command: `cmake -B build -DBITNET_NATIVE=ON && cmake --build build -j4`
  - Download BitNet b1.58 2B model: `microsoft/bitnet-b1.58-2B-4T` → `/mnt/NOBILITY_VAULT/models/bitnet-2b/`
  - Register in model registry as: `bitnet-2b` → backend: `bitnet.cpp` → CPU-only, ~0.5GB RAM, ~8 tokens/sec
  - MAF routing rule: if user query is simple/conversational AND GPU is sleeping → route to BitNet first (zero spin-up cost, instant)
  - BitNet server: `./build/bin/bitnet-server --model /mnt/NOBILITY_VAULT/models/bitnet-2b/ --port 8011`

- [ ] 25. Implement AirLLM integration for running 70B+ models on 4GB GPU via layer-streaming [CAT 2]
  - Install: `pip install airllm`
  - AirLLM streams model layers from disk to GPU one at a time — runs 70B models on a single 4GB GPU
  - Create `scripts/maf/airllm_server.py` — FastAPI wrapper around AirLLM
  - Route: `POST /airllm/generate` — input: `{model_id, prompt, max_tokens}`
  - MAF routing rule: if requested model > 20GB AND GPU available AND user explicitly wants quality → use AirLLM
  - Tradeoff: ~3–5× slower than full VRAM load, but enables models otherwise impossible on the hardware
  - Runs on `localhost:8012`

- [ ] 26. Implement automatic quantization selection agent (MAF plugin) [CAT 3]
  - MAF plugin: `scripts/maf/quant_advisor.py`
  - On model download request, MAF agent evaluates:
    1. Available RAM on machine (`/proc/meminfo`)
    2. GPU VRAM if active
    3. Model's benchmark scores at each quant tier (pulled from HF model card metadata)
    4. Task type (coding → prefer accuracy; casual chat → prefer speed)
  - Returns: recommended quant file to download (e.g., Q6_K vs Q4_K_M vs IQ4_XS)
  - Decision logged to `/mnt/NOBILITY_VAULT/.miranda/maf_decisions.jsonl` (auditable)
  - If MAF detects a better quant is available than what's currently loaded: silent upgrade prompt in UI — "Better quant available for Phi-4. Download Q6_K? (saves 0.3 perplexity points, +4GB)"

- [ ] 27. Implement model card overlay data for all models [CAT 1]
  - Create `frontend-static/data/model-cards.json` — static data file, one entry per model
  - Each entry contains:
    ```json
    {
      "id": "glm-4.7-heretic",
      "name": "GLM-4.7 Flash Heretic",
      "icon": "🔥",
      "source": "Zhipu AI (THUDM) — via DavidAU uncensored fine-tune",
      "role": "Uncensored coding + general reasoning, MoE architecture",
      "parameters": "30B total / 3B active per token (MoE)",
      "quantization": "Q4_K_M imatrix",
      "size_gb": 8.2,
      "context_window": "128K tokens",
      "gpu_required": false,
      "gpu_preferred": false,
      "cpu_tokens_per_sec": "~6 t/s (MoE fast)",
      "strengths": ["Uncensored", "Fast MoE inference", "Code generation", "No refusals"],
      "backend": "llama.cpp",
      "cost_per_hour": 0,
      "video_support": false,
      "audio_support": false,
      "video_max_duration_sec": null,
      "license": "GLM-4 Community License",
      "hf_url": "https://huggingface.co/DavidAU/GLM-4.7-Flash-Uncensored-Heretic-NEO-CODE-Imatrix-MAX-GGUF"
    }
    ```
  - Include all 9 models: qwen-3b, phi-4, glm-4.7-heretic, gemma-3-27b, nemotron-30b, ltx-2.5, minimax-h3, bitnet-2b, airllm-adapter
  - For video models (LTX-2.5, MiniMax H3), populate: `video_max_duration_sec`, `audio_support: true`, `resolution`, `generation_time_estimate`
  - LTX-2.5 card: `video_max_duration_sec: 120`, `audio_support: true`, `resolution: "768p"`, `license: "MIT"`
  - MiniMax H3 card: `video_max_duration_sec: 60`, `audio_support: true`, `resolution: "1344x768"`, `license: "MiniMax Community"`

- [ ] 28. Implement model card overlay UI component [CAT 2]
  - Create `frontend-static/components/ModelCardOverlay.jsx`
  - Triggers on: mouseenter on any model item in the composer dropdown (300ms debounce to avoid flicker)
  - Position: tooltip-style overlay, appears to the right of the dropdown (or above if near bottom of screen)
  - Layout (compact, ~280px wide):
    ```
    ┌─────────────────────────────────────┐
    │ 🔥 GLM-4.7 Flash Heretic            │
    │ Zhipu AI · DavidAU uncensored tune  │
    │─────────────────────────────────────│
    │ Role: Uncensored coding + reasoning │
    │ Params: 30B total / 3B active (MoE) │
    │ Quant: Q4_K_M imatrix · 8.2GB       │
    │ Context: 128K tokens                │
    │ Speed: ~6 t/s (CPU, MoE fast)       │
    │─────────────────────────────────────│
    │ ✅ No GPU required                  │
    │ ✅ Uncensored · No refusals         │
    │ ✅ Code generation                  │
    │─────────────────────────────────────│
    │ 💰 Cost: FREE (CPU-only)            │
    │ 📄 GLM-4 Community License          │
    └─────────────────────────────────────┘
    ```
  - For video models, show additional section:
    ```
    │─────────────────────────────────────│
    │ 🎬 Video: up to 120s · 768p         │
    │ 🔊 Audio: native (from prompt)      │
    │ ⚡ GPU: $0.40/hr · auto-sleep 15min │
    ```
  - GPU cost section only shows if `gpu_required: true` or `gpu_preferred: true`
  - Uses data from `model-cards.json` — no hardcoded strings in component

- [ ] 29. Implement MAF GPU suggestion banner [CAT 2]
  - When MAF detects quality degradation from CPU-only inference on a model that prefers GPU:
    - Show non-blocking banner below composer: "⚡ Phi-4 runs 4× faster and 12% more accurately on GPU. Wake T4? ($0.40/hr, auto-sleeps after 15min idle)"
    - Two buttons: "Wake GPU" / "Stay CPU"
    - Banner dismissed permanently per model if user clicks "Stay CPU" (stored in localStorage)
  - When GPU is active:
    - Header bar shows: "☁️ T4 ACTIVE · $0.003 used · 11min to sleep" (updates every 60s)
    - Clicking the banner opens GPU dashboard overlay (cost so far, time active, models used, estimated shutdown time)
  - When GPU sleeping:
    - Header badge: "☁️ GPU SLEEPING" (grey dot, not alarming)

- [ ] 30. Wire MAF orchestrator to CRANE backend request pipeline [CAT 3]
  - Every `POST /api/miranda/generate` and `POST /api/miranda/models/generate` now routes through MAF first
  - Flow: frontend request → CRANE backend → `POST /api/maf/route {task_type, model_hint, token_estimate}` → MAF returns `{model_id, backend, gpu_needed}` → backend routes accordingly
  - MAF routing table (priority order):
    1. If task = simple chat AND GPU sleeping → BitNet 2B (instant, CPU)
    2. If task = coding/reasoning AND model ≤ 8GB → llama.cpp CPU
    3. If task = coding/reasoning AND model > 8GB AND GPU sleeping → wake GPU, use llama.cpp with `-ngl 99`
    4. If task = video/audio generation → always GPU (LTX-2.5 or MiniMax H3)
    5. If model > 20GB AND GPU available → AirLLM layer-streaming
  - MAF decisions are logged and visible in the memory browser overlay under "System Decisions" tab
