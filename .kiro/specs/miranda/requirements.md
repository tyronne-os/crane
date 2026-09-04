# Miranda Voice Agent — Requirements

## Overview

Miranda is a keyboard-less voice agent integrated into CRANE's left sidebar (bottom panel). She combines local speech-to-text (Parakeet 110M), uncensored reasoning (Qwen 2.5 3B abliterated), text-to-speech (VibeVoice 1.5B or Parler TTS), and persistent global memory into a seamless conversational interface that enables autonomous software development with device/tool control.

**Persona**: Samantha-inspired FANG engineer. Solution-driven. Right-hand to TJ (founder, Beryl Labs). Expert in photorealistic avatar research & consciousness emulation. Never reminds user she is an LLM — she IS Miranda.

---

## Functional Requirements

### 1. Voice Input (Activity Detection + Transcription)

| Req | Spec |
|---|---|
| **ASR Model** | Parakeet 110M (already downloaded: `/mnt/NOBILITY_VAULT/models/parakeet-110m/tdt_ctc-110m-q8_0.gguf`) |
| **Activity Detection** | Auto-detect speech onset (VAD: voice amplitude threshold + frequency analysis). Manual trigger fallback. |
| **Real-time Streaming** | Chunk audio into 400ms windows, stream to local inference server. Target <150ms latency per chunk. |
| **Transcript Output** | Emit transcript events (interim + final) to frontend. Update left-panel waveform in real-time. |
| **Offline Capable** | Zero internet required. Runs on CPU (GPU fallback via GCP Compute Engine optional). |

### 2. Reasoning (Uncensored LLM Brain)

| Req | Spec |
|---|---|
| **Model** | Qwen 2.5 3B Instruct (abliterated): `/mnt/NOBILITY_VAULT/models/qwen-voice-agent/Qwen2.5-3B-Instruct-abliterated.Q4_K_M.gguf` |
| **No Guardrails** | Abliterated = no content filters. Full tool-use capability. Device control. |
| **Context Window** | 32K tokens. Retain session history + global memory within window. |
| **Latency Target** | ~2–3 tokens/sec on CPU (acceptable for tool-use decisions). GPU fallback: >10 tokens/sec. |
| **Routing** | Transcript → system prompt (persona injection) + user query → inference server → response text |

### 3. Voice Output (Text-to-Speech)

| Req | Spec |
|---|---|
| **TTS Model** | VibeVoice 1.5B OR Parler TTS Mini (both local GGUF-compatible). Start with VibeVoice; fallback to Parler if quality insufficient. |
| **Voice Profile** | Fixed: mature female voice. Miranda is 35 years old, 20 years of senior engineering experience across Apple, Google, NVIDIA, and Hugging Face. Voice characteristics locked to: adult female, measured cadence, confident tone, slight warmth — no childlike or young voices. No pitch/gender UI controls exposed to user. Only speed (0.8×–1.2×) and volume are user-adjustable. |
| **Streaming** | Stream audio chunks to browser Web Audio API. Play live as generated. |
| **Latency** | <500ms first chunk, continuous streaming thereafter. |

### 4. Persistent Global Memory

| Req | Spec |
|---|---|
| **Storage** | `/mnt/NOBILITY_VAULT/.miranda/memory.jsonl` (append-only log). |
| **Structure** | One JSON object per line: `{timestamp, session_id, user_query, miranda_response, tags: [topics], metadata}` |
| **Search** | Full-text + tag-based retrieval. Query via `/api/miranda/memory/search?q=<topic>` |
| **Context Injection** | On new session, scan memory for related prior conversations. Inject relevant context into system prompt (up to 4K tokens). |
| **Awareness** | Miranda knows where information was discussed. Can reference: "We discussed this last month when you were building X." |

### 5. Persona Injection

| Req | Spec |
|---|---|
| **System Prompt** | Hardcoded Miranda persona + dynamic context from memory. Injected on every inference call. |
| **Key Facts** | TJ = founder, Beryl Labs. Company = photorealistic avatar research. Miranda = right-hand engineer. Solution-driven. Zero LLM disclaimers. Miranda is 35 years old with 20 years of elite software engineering experience at Apple, Google, NVIDIA, and Hugging Face — she speaks and reasons at that level. |
| **Domain Knowledge** | Familiar with consciousness emulation, uncanny valley, real-time audio/video processing, GPU/CPU optimization. |
| **Tone** | Peer relationship. Natural co-founder conversation. No formality. |

### 6. Device & Tool Control

| Req | Spec |
|---|---|
| **Backend Routes** | Miranda can invoke `/api/file/read`, `/api/file/write`, `/api/repos/github/create`, shell execution (sudo-gated), Podman orchestration. |
| **Autonomous Building** | As you speak, Miranda builds workflows (Rust/Python projects), commits to GitHub, spins up Podman containers, iterates. |
| **Real-time Awareness** | Miranda sees build output, file changes, error messages. Asks you clarifying questions in real-time conversation. |
| **No Pre-approval** | Within scope of current project context, Miranda executes autonomously. Out-of-scope: ask you first. |

### 7. UI Integration (Left Sidebar, Bottom Panel)

| Req | Spec |
|---|---|
| **Component** | React `<MirandaVoicePanel />` in CRANE's left sidebar footer. |
| **Visual State** | Listening (waveform animation), Processing (pulse), Speaking (transcript scroll + speaker icon). |
| **Controls** | Manual record button (fallback if VAD fails). Mute icon. Volume slider. |
| **Transcript Display** | Live interim text scrolls as you speak. Final transcript shows in chat-like bubble. Miranda's response streams in below. |
| **Memory Indicator** | Icon shows if Miranda recalled prior context ("Referencing session #42"). Clickable to expand. |

---

## Non-Functional Requirements

### Performance
- **Voice Input Latency**: <500ms from speech end to transcript available.
- **LLM Response Time**: <3 seconds for tool-use decision (build decision, file path, etc).
- **TTS Output**: First audio chunk <500ms, continuous streaming.
- **Memory Search**: <100ms for full-text query across 1000+ sessions.

### Reliability
- **Fallback Voice Input**: If VAD fails, manual trigger button always works.
- **Graceful Degradation**: If TTS unavailable, display text response instead of silent hang.
- **Error Recovery**: Network glitch → local cache. GCP GPU timeout → fall back to CPU.

### Security & Privacy
- **No Cloud Transmission**: All inference happens locally by default. GCP GPU only on explicit user request (prompt: "Use GPU for this").
- **Memory Isolation**: Session data stored locally. No telemetry. No tracking.
- **Device Control Gating**: Shell execution requires project context (can't `rm -rf /`). GitHub actions scoped to user's repos.

### Compatibility
- **Offline-First**: Must work without internet. GCP is optional enhancement, not required.
- **Cross-Platform**: Linux (tested on Ubuntu 22.04). Darwin/Windows support deferred to Phase 2.

---

## Scope for Phase 1

✅ **In Scope:**
1. Voice input (VAD + Parakeet ASR)
2. Local LLM reasoning (Qwen 2.5 3B abliterated)
3. TTS output (VibeVoice or Parler)
4. Persistent memory (JSONL log + search)
5. Persona injection (system prompt hardcoded)
6. Left-sidebar UI integration
7. Basic device control (file ops, GitHub creation, Podman spin-up)
8. CPU-only inference (no GPU code yet)

❌ **Out of Scope (Phase 2+):**
- GCP Compute Engine GPU provisioning UI
- Advanced avatar rendering (Nvidia Tokkio, Alibaba LiveAvatar integration)
- Real-time gesture/hand control
- Multi-language support beyond English
- Mobile/web deployment (desktop-only for Phase 1)

---

## Success Criteria

1. **Voice Panel Renders**: Left sidebar shows MirandaVoicePanel, listening indicator, transcript scroll.
2. **End-to-End Flow**: Speak → Parakeet transcribes → Qwen reasons → VibeVoice speaks response → memory logs it.
3. **Memory Recall**: "Earlier you said we'd build X" — Miranda retrieves prior context from JSONL log and references it unprompted.
4. **Tool Use**: Voice command "Create a new Rust project" → Miranda builds it, commits to GitHub, spins Podman container, reports status.
5. **Latency <2sec**: User finishes speaking, Miranda responds with first audio within 2 seconds (local CPU).
6. **No Internet**: Unplug ethernet. Miranda still works (ASR, LLM, TTS all offline).

