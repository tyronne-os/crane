# MIRANDA CRANE — Correction Handoff & Assembly Instructions

**Date filed:** September 4, 2026
**Filed by:** Kiro (AI agent), on explicit instruction from the project owner
**Status:** CORRECTIVE MIGRATION — read this entire document before touching any file below

---

## 1. What happened and why this document exists

Miranda is a voice-agent feature that was originally conceived and spec'd as
**part of the CRANE project** (`/mnt/NOBILITY_VAULT/qwen-kiro-ide/`, GitHub:
`tyronne-os/crane`, HF dataset: `AIBRUH/crane`). CRANE is a voice-enabled IDE
(a Kiro clone) that was already installed and running as a desktop app. The
CRANE repository already contains an original Miranda specification at
`.kiro/specs/miranda/` (requirements.md, design.md, tasks.md) describing her
as a local, on-device voice agent: Parakeet 110M for ASR, Qwen 2.5 3B
(abliterated) for reasoning, VibeVoice/Parler for TTS — a "Samantha-inspired
FANG engineer" persona embedded in CRANE's left sidebar.

**The mistake:** over the course of one overnight build session (evening of
Sep 3 into the morning of Sep 4, 2026), a large amount of new work — a
memory data lake (Neo4j/DuckDB/Obsidian), a conversational-intelligence
layer (mood tracking, state machine, autonomy calibration, partnership
tracking), and a Model Forge (LoRA fine-tuning / model merging system) — was
built and saved into a **separate, standalone repository** called
`miranda-engine` (GitHub: `tyronne-os/Miranda`, HF: `AIBRUH/miranda-engine`)
instead of being added into CRANE where the Miranda feature actually
belongs. This created two divergent things both named "Miranda": CRANE's
original local-inference voice agent spec, and a separate cloud-pipeline
engine that was never actually wired into CRANE at all.

**The correction being performed in this document:** every real, tested
file built during that overnight session in the `miranda-engine` repo is
being copied into CRANE, under this directory
(`miranda-personality-and-device-functionality/`), so that Miranda's new
capabilities live inside the project she was always meant to be part of.
The original `miranda-engine` standalone repo is NOT being deleted — it
remains on GitHub/HF as a historical record of the mistake and the source
of truth for exactly what was copied — but going forward, **CRANE is the
correct home for all Miranda development.**

---

## 2. Directory map — what is in here and where it came from

```
qwen-kiro-ide/                                    <- CRANE root (the actual IDE project)
├── .kiro/specs/miranda/                          <- ORIGINAL CRANE Miranda spec (pre-existing,
│                                                     local-inference voice agent — do not overwrite)
├── src-tauri/, backend/, frontend-static/         <- CRANE's actual IDE application code
│
└── miranda-personality-and-device-functionality/  <- THIS DIRECTORY (new, created by this
    │                                                  corrective migration)
    │
    ├── MIRANDA-CRANE-HANDOFF.md                   <- this file
    ├── HANDOFF-FROM-MIRANDA-ENGINE-REPO.md         <- verbatim copy of the miranda-engine repo's
    │                                                  own HANDOFF.md, exactly as it stood when
    │                                                  this migration was performed (historical
    │                                                  record — do not edit; add new status
    │                                                  updates to THIS file instead going forward)
    ├── CONVERSATIONAL_INTELLIGENCE.md              <- real measured test/benchmark report,
    │                                                  copied verbatim from miranda-engine
    │
    ├── .kiro/specs/
    │   ├── wo-memory-data-lake/                    <- requirements.md, design.md, tasks.md
    │   │                                              (Neo4j + DuckDB + Obsidian memory system)
    │   ├── wo-conversational-intelligence/         <- requirements.md, design.md, tasks.md
    │   │                                              (mood/state/persona/autonomy layer)
    │   └── wo-model-forge/                         <- requirements.md, design.md, tasks.md
    │                                                  (LoRA fine-tune + model merge system)
    │
    ├── miranda-nodes/
    │   ├── Cargo.toml                              <- dependency manifest for this Rust crate
    │   ├── src/
    │   │   ├── lib.rs                              <- crate root; declares memory/conversation/forge
    │   │   ├── memory/                             <- WO-Memory implementation (9 files)
    │   │   ├── conversation/                        <- WO-Conversational-Intelligence (10 files)
    │   │   ├── forge/                                <- WO-Model-Forge (9 files)
    │   │   └── bin/conversation-benchmarks.rs        <- real latency benchmark CLI
    │   └── tests/conversation_integration_tests.rs   <- 8 real cross-module integration tests
    │
    └── scripts/                                     <- Neo4j/DuckDB/vault init & health-check
                                                          shell scripts, EC2 provisioning, AWS setup
```

---

## 3. What is REAL and TESTED versus what is NOT — read this before claiming anything is done

This section exists because a prior documented failure in this project's own
history (`eve-ecc-docs/ORCHESTRATION-PIVOT.md`, referenced in the
build-standards rules) involved a placeholder being scored as if it were
real, working functionality. **Do not repeat that mistake with this
migration.** Everything below is stated exactly as verified, with the
actual verification method named.

### Real and verified (as of the migration date):
- **`miranda-nodes` crate compiles clean** — verified via `cargo build -p
  miranda-nodes` in the original `miranda-engine` repo, real command output,
  not assumed.
- **291+ unit and integration tests passing** — verified via `cargo test -p
  miranda-nodes`, real test runner output showing `test result: ok. 291
  passed; 0 failed; 2 ignored`.
- **WO-Memory**: mood classifier, entity extractor, Neo4j writer (including
  a real retry-exhaustion test against an actually-unreachable port),
  DuckDB writer (including a real temp-database round-trip test — this one
  had a genuine bug found and fixed: `duckdb-rs` does not support binding
  native LIST parameters, fixed by storing lists as JSON-encoded VARCHAR),
  Obsidian writer, retriever, prompt injection — all real logic, all tested.
- **WO-Conversational-Intelligence**: all 10 modules (mood_stream,
  state_machine, anticipation, interest_model, knowledge_updater,
  persona_injection, response_tuning, autonomy_calibration,
  partnership_tracker, prompt_builder) have real logic and real tests,
  including the two non-negotiable safety invariants:
  - `floor_categories_never_resolve_to_autonomous_under_any_interview_input`
    — proves destructive/production-impacting/high-blast-radius actions can
    NEVER be set to fully autonomous, regardless of any interview answer.
  - `banned_pattern_corpus_is_rejected_at_100_percent` — proves
    dependency/guilt language ("I need you", "don't leave") is rejected
    before ever being surfaced to the user.
  - 8 real cross-module integration tests (raw input → mood → state →
    moves → role → assembled prompt) — all passing.
  - Real measured latency benchmarks (debug build, not release — see
    `CONVERSATIONAL_INTELLIGENCE.md` for the honest caveat on this) — all
    four design.md budgets passed by 3-4 orders of magnitude.
- **WO-Model-Forge**: job parser (real intent classification, tested
  against 15+ labeled samples including scope-boundary detection for
  from-scratch-pretraining requests), model registry, naming engine
  (deterministic name generation with real collision resolution), GPU
  provisioner (real spending-threshold gate + 15-minute idle-teardown
  logic, both independently tested), compatibility validator (real
  architecture/tokenizer mismatch detection), job orchestrator (real
  confirm/cancel/progress state machine).

### NOT real yet — disclosed, not hidden:
- **`finetune_pipeline.rs` and `merge_pipeline.rs` have never executed a
  real LoRA training run or a real mergekit merge.** There is no GPU, no
  `peft`/`axolotl`/`mergekit` installation in the environment this was built
  in. What IS real and tested in these two files: the subprocess command
  construction (the actual argv that would be run), divergence-detection
  logic, coherence-smoke-test heuristics, and result-JSON parsing — all of
  which are independently correct and testable without a live GPU. The
  actual `Command::spawn()` call is an injected closure seam a real
  GPU-provisioned deployment would fill in. **Do not present these two
  modules as having produced a real fine-tuned or merged model. They have
  not.**
- **No application entry point exists.** Nothing in this migrated code
  starts a running process, opens a microphone, or talks to an LLM. This is
  a library of real, tested Rust functions and types — not yet a running
  Miranda you can have a conversation with.
- **Not wired to CRANE's existing frontend/backend/Tauri app at all.** This
  migration places the files inside the CRANE repository directory
  structure; it does NOT yet modify `src-tauri/`, `backend/`, or
  `frontend-static/` to actually call any of this code. That wiring is
  the next real piece of work — see Section 5.
- **Not wired to CRANE's original local-inference stack** (Parakeet /
  Qwen 2.5 3B abliterated / VibeVoice) described in
  `.kiro/specs/miranda/requirements.md`. The migrated code assumes a
  different architecture (AWS Bedrock/Polly/Transcribe cloud pipeline) —
  reconciling these two architectures is an open design decision, not yet
  made. See Section 6.
- **The "sovereign action layer" and 3x-daily AI news-digest loop**
  (GitHub/HF/NVIDIA/Medium/YouTube monitoring, discovery-session interview)
  discussed during the overnight session are still only a written plan.
  No code exists for either.
- **WO-Model-Forge Task 10** (full integration test suite + `MODEL_FORGE.md`
  performance report) was not completed before this migration — same
  disclosed-scope limitation as the fine-tune/merge pipelines above.

---

## 4. Step-by-step: how any agent picks this up and assembles it correctly

If you are an agent (or a human) starting fresh on this, follow these steps
in order. Do not skip the verification steps — re-run them yourself; do not
trust this document's claims without reproducing them.

### Step 1 — Verify the migrated code actually builds in place
```bash
cd /mnt/NOBILITY_VAULT/qwen-kiro-ide/miranda-personality-and-device-functionality/miranda-nodes
cargo build
```
This crate was extracted from a larger Cargo workspace (`miranda-engine`).
It may need its own standalone `Cargo.toml` `[package]` section fixed up,
or it may need to be added as a workspace member inside CRANE's own
`Cargo.toml` (`/mnt/NOBILITY_VAULT/qwen-kiro-ide/Cargo.toml`) — check
whether CRANE's existing Cargo.toml is a workspace root and add
`miranda-personality-and-device-functionality/miranda-nodes` as a member if
so. Do not assume it builds standalone without checking first — the
original crate had sibling crates (`miranda-transport`, `miranda-supervisor`,
`miranda-audio`) in its workspace that are NOT copied here because they were
not part of the personality/memory/forge work; if `lib.rs` or `Cargo.toml`
references anything from those sibling crates, that reference needs to be
resolved (either copy the needed sibling crate too, or refactor out the
dependency).

### Step 2 — Run the real test suite and confirm the same pass count
```bash
cargo test
```
Expect the same category of results reported in Section 3 above
(hundreds of tests, all passing) for the memory/conversation/forge modules.
If the count differs, that is a real signal something broke in the move —
investigate before proceeding, do not just re-state the old numbers.

### Step 3 — Reconcile the two Miranda specs (the open design decision)
Read both:
- `/mnt/NOBILITY_VAULT/qwen-kiro-ide/.kiro/specs/miranda/requirements.md`
  (original CRANE spec — local Parakeet/Qwen-abliterated/VibeVoice stack)
- `/mnt/NOBILITY_VAULT/qwen-kiro-ide/miranda-personality-and-device-functionality/.kiro/specs/wo-conversational-intelligence/requirements.md`
  (the mood/state/persona layer built overnight)

These describe the SAME character (Miranda) with DIFFERENT underlying
inference stacks (local GGUF models vs. a cloud AWS pipeline) and
DIFFERENT scopes (CRANE's spec is about IDE/device control; the migrated
spec is about conversational depth and memory). **Do not silently merge
these or discard either one.** This needs an explicit decision from the
project owner (TJ) on which inference stack Miranda actually runs on
inside CRANE, and how the conversational-intelligence layer (mood, state,
autonomy, partnership tracking) sits on top of whichever ASR/LLM/TTS stack
is chosen. Flag this decision point rather than guessing.

### Step 4 — Wire an actual entry point
Once Step 3's decision is made, the memory/conversation/forge modules in
`miranda-nodes/` need to be called from CRANE's real backend
(`/mnt/NOBILITY_VAULT/qwen-kiro-ide/backend/src/main.rs` — inspect this file
first, it already exists and may already have voice-agent scaffolding from
the original Miranda spec's implementation work). This is the step that
turns "291 tests pass" into "you can talk to Miranda inside CRANE." Do not
consider this migration complete until this wiring exists and has been
manually tested by a human talking to the running app.

### Step 5 — Update THIS document, not the old one
Once further progress is made, add new dated status sections to
`MIRANDA-CRANE-HANDOFF.md` (this file). The
`HANDOFF-FROM-MIRANDA-ENGINE-REPO.md` file in this same directory is a
historical snapshot — leave it untouched as a record of what was copied and
when.

---

## 5. Non-negotiable properties that MUST continue to hold after any further changes

Any agent modifying this code in the future must preserve these two
structurally-enforced invariants — they are not optional defaults, they are
type-level guarantees in the current code (see the doc comments inside
`autonomy_calibration.rs` and `partnership_tracker.rs` for exactly how):

1. **Autonomy floor**: `DestructiveAtScale`, `ProductionImpacting`, and
   `HighBlastRadius` action categories can never resolve to `Autonomous`,
   regardless of any user interview answer or accumulated track record.
2. **Non-dependency content filter**: any partnership/progress
   acknowledgment text must pass a banned-pattern filter (rejecting
   dependency/guilt language) before it is ever surfaced to the user.

If a future change touches either `autonomy_calibration.rs` or
`partnership_tracker.rs`, re-run their existing test suites
(`floor_categories_never_resolve_to_autonomous_under_any_interview_input`
and `banned_pattern_corpus_is_rejected_at_100_percent` specifically) and
confirm they still pass before considering the change safe.

---

## 6. Repository/remote status (for anyone deciding what to do with the old repo)

- **`miranda-engine` (the mistakenly-separate repo)**: GitHub
  `tyronne-os/Miranda` (renamed from `tyronne-os/miranda`, old URL
  redirects), HF backup `AIBRUH/miranda-engine`. Left in place as historical
  record; not deleted by this migration. Contains an embedded HF auth token
  in its `huggingface` git remote URL (flagged for rotation, not yet
  rotated as of this writing).
- **CRANE (the correct home)**: GitHub `tyronne-os/crane`, HF dataset
  `AIBRUH/crane`. Also has an embedded HF auth token in its `hf` git remote
  URL — same rotation flag applies here.
- Neither repository's embedded tokens have been rotated as of this
  migration. This is a security item independent of the migration itself
  and should be addressed by the project owner directly (revoke + reissue
  at https://huggingface.co/settings/tokens), not by an agent editing git
  remotes without explicit instruction.


---

## 7. CORRECTION — this migration was rebuilt on the wrong git history, then fixed

**Filed:** shortly after Section 6, same day.

The first version of this migration was committed on top of the `hf-clean`
branch (2 commits total: an initial CRANE snapshot + this migration). That
branch was missing 12 real commits that exist on `origin/master` — the
actual Tauri desktop app build, backend wiring, production launcher, and
**a separate, more complete Miranda voice-agent spec already committed to
CRANE by a prior session** (commit `6c30c54`, "Miranda voice agent spec —
full architecture, model roster, MAF orchestration, GPU cost manager,
custom LLM forge" — 947 lines across requirements/design/tasks.md).

**This is a significant finding, not a minor detail:** that pre-existing
spec already describes a Model Forge (custom LLM naming convention,
females-only naming, GPU cost model with a 15-minute idle-sleep timer,
dollar-cost tracking, MAF orchestration) that closely parallels the
`wo-model-forge` spec built independently overnight in `miranda-engine`.
**These two Model Forge designs were NOT reconciled before this migration.**
Anyone continuing this work must read `.kiro/specs/miranda/design.md` (the
pre-existing 481-line CRANE design doc) side-by-side with
`miranda-personality-and-device-functionality/.kiro/specs/wo-model-forge/design.md`
and decide which naming/cost-model/orchestration approach is authoritative,
or how to merge them. Do not assume either one wins by default.

**What was corrected:** this migration's files were re-applied on top of
the real `origin/master` history (branch `miranda-crane-migration-v2`)
instead of the incomplete `hf-clean` base, so the pushed branch now
contains the actual installed CRANE app history plus this migration, not
an isolated 2-commit snapshot missing 12 commits of real work.

**Also discovered at this point:** uncommitted local changes existed to
`.kiro/specs/miranda/design.md`, `tasks.md`, and `backend/src/main.rs`
from work prior to this migration, unrelated to it. These were stashed
(`git stash`) rather than discarded, so they are not lost — whoever
continues this work should run `git stash list` and `git stash show -p`
to inspect and decide whether to re-apply them.
