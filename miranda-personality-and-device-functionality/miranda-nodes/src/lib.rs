//! miranda-nodes — Miranda's personality, memory, and model-forge brain.
//!
//! Three active modules:
//! - `conversation` — mood, state machine, 5 persona roles, anticipation,
//!   autonomy calibration, partnership tracking, prompt assembly
//! - `memory` — JSONL data lake + DuckDB analytics + Neo4j graph + Obsidian vault
//! - `forge` — Model Forge: LoRA fine-tune/merge orchestration, naming, GPU gating
//!
//! Avatar/blendshape modules (blink, breath, compositor, dispatcher, gaze,
//! solver, verify, viseme) are declared out until 3D avatar work resumes.

pub mod conversation;
pub mod forge;
pub mod memory;
