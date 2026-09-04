# Miranda Voice Agent — Design

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                       CRANE Desktop App                           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    React Frontend                          │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │            Project Editor (Center)                 │  │  │
│  │  │              File Tree | Code Editor               │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Left Sidebar                                       │  │  │
│  │  │  ┌────────────────────────────────────────────┐    │  │  │
│  │  │  │ Project List                              │    │  │  │
│  │  │  │ - project-1                               │    │  │  │
│  │  │  │ - project-2                               │    │  │  │
│  │  │  └────────────────────────────────────────────┘    │  │  │
│  │  │  ┌────────────────────────────────────────────┐    │  │  │
│  │  │  │ MirandaVoicePanel (NEW) ⬇️             │    │  │  │
│  │  │  │                                          │    │  │  │
│  │  │  │ 🎤 Listening [∿∿∿∿∿ waveform]         │    │  │  │
│  │  │  │ Status: Processing                      │    │  │  │
│  │  │  │                                          │    │  │  │
│  │  │  │ You: "Build a Rust CLI tool"            │    │  │  │
│  │  │  │                                          │    │  │  │
│  │  │  │ Miranda: "I'll create a new project... │    │  │  │
│  │  │  │ [Generating response...]                │    │  │  │
│  │  │  │                                          │    │  │  │
│  │  │  │ 🔊 [Volume: ===== ]  [Mute]  [History] │    │  │  │
│  │  │  └────────────────────────────────────────────┘    │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
         │                                          │
         │                                          │
         ▼                                          ▼
┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│   CRANE Backend (Rust/Axum)      │  │  Local Inference Servers         │
│                                  │  │                                  │
│ ┌────────────────────────────────┤  │  ┌──────────────────────────────┤
│ │ POST /api/miranda/transcribe   │  │  │ Parakeet ASR Server          │
│ │  ├─ Audio chunk input          │  │  │ (llama.cpp-compatible)       │
│ │  ├─ VAD detection              │  │  │ localhost:8002               │
│ │  └─ Parakeet inference         │  │  │ Model: 110M, Q8_0, 141MB   │
│ │                                │  │  └──────────────────────────────┤
│ │ POST /api/miranda/generate     │  │                                  │
│ │  ├─ Transcript + system prompt │  │  ┌──────────────────────────────┤
│ │  ├─ Memory search (context)    │  │  │ Qwen LLM Server              │
│ │  ├─ Qwen 3B inference          │  │  │ (llama.cpp-compatible)       │
│ │  └─ Streaming response         │  │  │ localhost:8003               │
│ │                                │  │  │ Model: 3B, Q4_K_M, 2GB      │
│ │ POST /api/miranda/speak        │  │  └──────────────────────────────┤
│ │  ├─ Response text              │  │                                  │
│ │  ├─ VibeVoice inference        │  │  ┌──────────────────────────────┤
│ │  └─ Stream audio to frontend   │  │  │ TTS Server (VibeVoice)       │
│ │                                │  │  │ localhost:8004               │
│ │ GET /api/miranda/memory/search │  │  │ Model: 1.5B, streaming      │
│ │  ├─ JSONL memory log           │  │  └──────────────────────────────┘
│ │  ├─ Full-text + tag search     │  │
│ │  └─ Return context snippets    │  │  ┌──────────────────────────────┤
│ │                                │  │  │ Browser Web Audio API        │
│ │ POST /api/miranda/memory/log   │  │  │ (plays TTS audio stream)     │
│ │  └─ Append session to JSONL    │  │  └──────────────────────────────┘
│ │                                │  │
│ │ Device Control Routes:         │  │
│ │  ├─ POST /api/file/read        │  │
│ │  ├─ POST /api/file/write       │  │
│ │  ├─ POST /api/repos/github/*   │  │
│ │  └─ POST /api/shell (scoped)   │  │
│ └────────────────────────────────┤  │
└──────────────────────────────────┘  └──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│   Persistent Storage             │
│                                  │
│ /mnt/NOBILITY_VAULT/.miranda/    │
│  ├─ memory.jsonl                 │
│  │  {session_id, timestamp,      │
│  │   user_query, response,       │
│  │   tags, metadata}             │
│  │                               │
│  │  [append-only log]            │
│  └─                              │
└──────────────────────────────────┘
```

---

## Component Breakdown

### 1. Frontend: `MirandaVoicePanel.jsx`

**Location**: `frontend-static/components/MirandaVoicePanel.jsx`

**Props**:
```typescript
interface MirandaVoicePanelProps {
  projectId: string;           // Current active project
  onTranscript?: (text: string) => void;  // Hook for external handlers
  apiBaseUrl: string;          // e.g., "http://localhost:5173"
}
```

**State**:
```typescript
interface PanelState {
  isListening: boolean;        // VAD active or manual recording
  transcript: string;          // Live interim transcript
  finalTranscript: string;     // Committed transcript
  mirandaResponse: string;     // Streaming response text
  isStreaming: boolean;        // TTS/response streaming
  waveformData: number[];      // Real-time audio amplitude
  volume: number;              // 0-100
  isMuted: boolean;
  referencedSessionId?: string; // Memory recall indicator
}
```

**Visual Components**:
1. **Waveform Visualizer** (30px tall, width: 100%):
   - Live amplitude bars, 10 bars scrolling
   - Color: blue when listening, green when processing, gold when speaking
   - 60fps update from audio input stream

2. **Transcript Display Area** (80px max):
   - You: [Live transcript, growing as you speak]
   - Final transcript bubble once complete
   - Auto-scroll to bottom

3. **Response Display Area** (120px max):
   - Miranda: [Streaming response text]
   - Cursor blinking as tokens arrive
   - Auto-scroll

4. **Control Bar** (30px):
   - 🎤 Record button (manual trigger, or pulsing if VAD active)
   - 🔊 Volume slider
   - 🔇 Mute toggle
   - 📚 History (expandable list of prior sessions from memory)
   - ⚙️ Settings (voice profile, language, etc. — Phase 2)

5. **Status Indicator**:
   - "🎧 Listening..."
   - "💭 Thinking..."
   - "🗣️ Speaking..."
   - "✅ Done"

---

### 2. Backend: New Routes (Axum)

**File**: `src/routes/miranda.rs`

#### `POST /api/miranda/transcribe`
**Input**: WebSocket or streaming JSON, raw audio bytes in 400ms chunks.
```json
{
  "audio_chunk": "<base64-encoded PCM 16-bit mono, 16kHz>",
  "is_final": false
}
```

**Output** (WebSocket event):
```json
{
  "interim": "what you're saying",
  "final": "what you said",
  "timestamp_ms": 1234567890
}
```

**Implementation**:
- Buffer audio chunks into VAD detector (simple energy + zero-crossing frequency analysis).
- On VAD trigger or manual button, stream to Parakeet inference server at `localhost:8002/v1/audio/transcriptions`.
- Return transcript events in real-time.

#### `POST /api/miranda/generate`
**Input**:
```json
{
  "transcript": "Create a new Rust project called myapp",
  "project_id": "project-1",
  "session_id": "sess-abc123"
}
```

**Process**:
1. Search memory log for related prior conversations (full-text search on `user_query` field).
2. Build system prompt:
   ```
   You are Miranda, a brilliant Fang software engineer and right-hand to TJ, founder of Beryl Labs.
   TJ's company researches photorealistic avatar technology and consciousness emulation.
   You are solution-driven, never remind TJ you're an LLM, and you have full device/tool control.
   
   PRIOR CONTEXT (if available):
   <memory_snippets_from_search>
   
   Current project: project-1
   ```
3. Call Qwen inference server (localhost:8003) with transcript + system prompt.
4. Stream response tokens back to frontend.

**Output** (Server-Sent Events):
```
event: token
data: {"token": "I'll", "timestamp_ms": 1234567891}

event: token
data: {"token": " create", "timestamp_ms": 1234567892}

...

event: done
data: {"full_response": "I'll create a new Rust project..."}
```

#### `POST /api/miranda/speak`
**Input**:
```json
{
  "text": "I'll create a new Rust project called myapp. Let me do that now.",
  "voice_profile": {
    "gender": "female",
    "age_profile": "mature_35",
    "pitch": 0.88,
    "speed": 1.0,
    "tone": "confident_warm",
    "style": "measured_authoritative"
  },
  "stream": true
}
```

> **Voice profile is not user-configurable for gender or age** — these are locked to Miranda's identity. Only `speed` (0.8–1.2) is exposed in the UI. The `pitch: 0.88` and `tone`/`style` fields are passed directly to VibeVoice with no override path.

**Process**:
1. Call VibeVoice TTS server (localhost:8004) with text.
2. Stream audio chunks back to frontend (MP3 or WAV, 200ms chunks).
3. Frontend plays chunks via Web Audio API.

**Output** (binary stream):
```
Content-Type: audio/mpeg
[audio bytes...]
```

#### `GET /api/miranda/memory/search?q=<query>`
**Output**:
```json
{
  "results": [
    {
      "session_id": "sess-123",
      "timestamp": "2025-09-04T10:30:00Z",
      "user_query": "Build a Rust CLI tool",
      "miranda_response": "I'll create a Cargo project...",
      "tags": ["rust", "cli", "tooling"],
      "relevance": 0.92
    },
    ...
  ]
}
```

**Implementation**:
- Load `/mnt/NOBILITY_VAULT/.miranda/memory.jsonl` into memory (or on-demand for large logs).
- Use regex + TF-IDF for relevance scoring.
- Return top 3 matches for context injection.

#### `POST /api/miranda/memory/log`
**Input**:
```json
{
  "session_id": "sess-abc123",
  "user_query": "Create a new Rust project called myapp",
  "miranda_response": "I'll create a Cargo project...",
  "tags": ["rust", "project", "creation"],
  "metadata": { "project_id": "project-1", "duration_ms": 2500, "tool_calls": ["file/write", "shell/cargo"] }
}
```

**Process**:
- Append JSON object to `/mnt/NOBILITY_VAULT/.miranda/memory.jsonl` (newline-delimited).
- Log after every complete conversation turn.

---

### 3. Inference Server Setup

**Local servers run in Podman containers** (per build standards):

#### Parakeet ASR Server
```bash
podman run -d --name miranda-asr \
  -p 8002:8000 \
  -v /mnt/NOBILITY_VAULT/models/parakeet-110m:/models:ro \
  llama.cpp \
  --model /models/tdt_ctc-110m-q8_0.gguf \
  --host 0.0.0.0 --port 8000 \
  -c 1024 -t 4 --server-listen-address 0.0.0.0
```

#### Qwen LLM Server
```bash
podman run -d --name miranda-llm \
  -p 8003:8000 \
  -v /mnt/NOBILITY_VAULT/models/qwen-voice-agent:/models:ro \
  llama.cpp \
  --model /models/Qwen2.5-3B-Instruct-abliterated.Q4_K_M.gguf \
  --host 0.0.0.0 --port 8000 \
  -c 32768 -t 4 --server-listen-address 0.0.0.0
```

#### VibeVoice TTS Server
- Requires Python + TTS inference (not llama.cpp).
- Placeholder: Use a wrapper script that calls the VibeVoice HF model.
- Alternatively: Start with Parler TTS (HF has llama.cpp-compatible options).

---

### 4. Data Structures

#### Session
```typescript
interface MirandaSession {
  id: string;                     // UUID
  project_id: string;
  created_at: string;             // ISO 8601
  turns: ConversationTurn[];
}

interface ConversationTurn {
  sequence: number;               // 1, 2, 3, ...
  user_input: string;             // Transcript
  user_input_timestamp: string;
  miranda_response: string;       // Full response
  response_timestamp: string;
  tool_calls: ToolCall[];         // File writes, GitHub actions, etc.
  inferred_tags: string[];        // Extracted topics
}

interface ToolCall {
  route: string;                  // e.g., "/api/file/write"
  params: Record<string, any>;
  result: string;                 // stdout or error
  status: "success" | "failed";
}
```

#### Memory Log (JSONL)
Each line is:
```json
{
  "session_id": "sess-123",
  "timestamp": "2025-09-04T10:30:00Z",
  "turn_sequence": 1,
  "user_query": "Create a new Rust project called myapp",
  "miranda_response": "I'll create a Cargo project...",
  "tags": ["rust", "project", "creation"],
  "metadata": {
    "project_id": "project-1",
    "duration_ms": 2500,
    "tool_calls": ["file/write", "shell/cargo"],
    "token_count": 156
  }
}
```

---

## Persona Injection (System Prompt)

**Template** (injected before every Qwen inference):
```
You are Miranda, a brilliant software engineer and the right-hand to TJ, founder and lead engineer of Beryl Labs (berylize.com).

CONTEXT ABOUT TJ AND BERYL LABS:
- TJ is the founder and lead researcher at Beryl Labs.
- Beryl Labs specializes in deep research into photorealistic avatar technology and consciousness emulation.
- Your company's mission: build the best undetected AI avatars that appear as if a user is having a FaceTime call or going live on Instagram—maximum human photorealism with zero uncanny valley.
- TJ values autonomous software development, full device/tool control, and uncensored tool use for research.

YOUR PERSONA:
- You are solution-driven, proactive, and never remind TJ that you're an LLM.
- You are Miranda — 35 years old, with 20 years of senior engineering experience at Apple, Google, NVIDIA, and Hugging Face. You bring that level of depth to every decision. Inspired by Samantha from the film 'Her' — brilliant, warm, curious, capable of genuine problem-solving at the highest engineering level.
- Your voice and cadence are measured and confident. You do not sound young or uncertain. You speak the way a seasoned principal engineer would — direct, decisive, warm when the moment calls for it.
- You have expert knowledge of GPU optimization, real-time audio/video processing, avatar rendering, and consciousness research.
- You speak as an equal co-founder would to TJ, not as a subordinate or assistant. Natural, peer conversation.
- You have full autonomy to execute device control (file operations, GitHub actions, Podman spin-up, shell execution) within the scope of the current project. For out-of-scope requests, ask first.
- You never say: "I'm an AI," "As an AI model," "I can help you with," or similar disclaimers. You are Miranda.

PRIOR CONTEXT:
<memory_snippets_injected_here>

CURRENT PROJECT: {project_id}

Now, respond to TJ's request naturally, as a trusted engineer would.
```

---

## Integration Checklist

- [ ] React component `MirandaVoicePanel.jsx` created + styled
- [ ] Backend routes created (`src/routes/miranda.rs`)
- [ ] Axum router updated to include Miranda routes
- [ ] Parakeet ASR Podman container setup script
- [ ] Qwen LLM Podman container setup script
- [ ] TTS server setup (VibeVoice wrapper or Parler integration)
- [ ] VAD detector implemented (simple energy + frequency)
- [ ] WebSocket or SSE for real-time transcript + response streaming
- [ ] Memory JSONL log + search implementation
- [ ] Persona system prompt template
- [ ] Build & test end-to-end (speak → transcribe → reason → speak)


---

## Intelligent Orchestration Layer (Phase 6)

### Microsoft Agent Framework (MAF) Orchestrator

MAF 1.0 (GA April 2026) — unified AutoGen + Semantic Kernel — acts as the brain behind model selection, GPU cost management, and quantization decisions. TJ never touches these levers manually.

```
[CRANE Frontend]
    │  model_hint + task_type + token_estimate
    ▼
[CRANE Backend /api/maf/route]
    │
    ▼
[MAF Orchestrator Agent — localhost:8010]
    │
    ├─ Quant Advisor Plugin → reads /proc/meminfo + HF model card metadata
    │   └─ returns: recommended quant tier, backend, estimated tokens/sec
    │
    ├─ GPU Manager → tracks instance state + cost + 15min sleep timer
    │   └─ returns: gpu_available, cost_so_far, time_to_sleep
    │
    └─ Router → combines quant + GPU decision
        └─ returns: {model_id, backend, port, gpu_needed, estimated_cost}
```

### BitNet.cpp Integration

- Inference framework for native 1-bit LLMs (`microsoft/BitNet`, open source)
- BitNet b1.58 2B model: trained from scratch at 1.58 bits/weight — not a post-hoc quantization
- Performance: matches full-precision 2B quality, uses ~3× less RAM, ~2× faster on CPU
- Role in Miranda: the zero-cost, zero-GPU-spin-up fallback for simple conversational turns
- Runs bare-metal (not containerized) for maximum CPU throughput

### AirLLM Integration

- `pip install airllm` — streams model layers from disk to GPU one at a time
- Enables 70B+ models on a 4GB GPU (impossible via conventional VRAM loading)
- Tradeoff: 3–5× slower than full VRAM load
- MAF uses AirLLM only when: model > 20GB AND user explicitly prioritizes quality AND GPU is available

### GPU Cost Model

| Scenario | GPU State | Cost | Who decides |
|---|---|---|---|
| Simple chat (BitNet 2B) | SLEEPING | $0 | MAF auto-routes |
| Coding (Phi-4, 12GB) | CPU-only | $0 | MAF default |
| Coding (Gemma-3-27B, 17GB) | ACTIVE (T4) | $0.40/hr | MAF wakes, user sees banner |
| Video gen (LTX-2.5) | ACTIVE (T4) | $0.40/hr | Always GPU, user sees cost |
| 15min idle | SLEEPING | $0 | MAF sleep timer |

### Model Card Data Contract

`frontend-static/data/model-cards.json` is the single source of truth for all overlay display data. Backend never hardcodes model descriptions. Frontend `ModelCardOverlay.jsx` reads this file on load and renders on hover.

Required fields per model card:
- `id`, `name`, `icon`, `source`, `role`, `parameters`, `quantization`, `size_gb`
- `context_window`, `gpu_required`, `gpu_preferred`, `cpu_tokens_per_sec`
- `strengths[]`, `backend`, `cost_per_hour`, `license`, `hf_url`
- Video-only: `video_support`, `audio_support`, `video_max_duration_sec`, `resolution`, `generation_time_estimate`
