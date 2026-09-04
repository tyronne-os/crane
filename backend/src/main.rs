use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use miranda_nodes::conversation::{
    mood_stream::{MoodStreamProcessor, MoodVector},
    persona_injection::{detect_role, Role},
    prompt_builder::{build_prompt, RetrievedContext, DEFAULT_TOKEN_BUDGET},
    state_machine::{detect_cue, StateMachine, State as ConvState},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::process::Command;
use std::sync::Arc;
use tokio::sync::Mutex;

// ===== Config =====

/// Returns the CRANE projects root. Reads `CRANE_HOME` env var first;
/// falls back to `~/crane-projects` so the app works on any machine
/// without needing `/mnt/NOBILITY_VAULT` to exist.
fn crane_home() -> String {
    std::env::var("CRANE_HOME").unwrap_or_else(|_| {
        dirs::home_dir()
            .map(|h| h.join("crane-projects").to_string_lossy().into_owned())
            .unwrap_or_else(|| "/tmp/crane-projects".to_string())
    })
}

fn projects_dir() -> String {
    format!("{}/projects", crane_home())
}

fn projects_store_path() -> String {
    format!("{}/.crane/projects.json", crane_home())
}

// ===== Data types =====

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub name: String,
    pub language: String,
    pub path: String,
    pub containerized: bool,
    pub container_runtime: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ProjectsStore {
    pub projects: Vec<Project>,
}

impl ProjectsStore {
    fn load() -> Self {
        let path = projects_store_path();
        if let Ok(data) = fs::read_to_string(&path) {
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            ProjectsStore::default()
        }
    }

    fn save(&self) {
        let path = projects_store_path();
        if let Some(parent) = std::path::Path::new(&path).parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(data) = serde_json::to_string_pretty(self) {
            let _ = fs::write(path, data);
        }
    }
}

/// One stored conversation turn (user message + Miranda response pair).
pub struct ConvTurn {
    pub user_text: String,
    pub miranda_text: String,
}

/// Per-session Miranda conversation state — mood, state machine, role,
/// and message history all live here so each turn builds on the last.
pub struct MirandaSession {
    pub machine: StateMachine,
    pub mood_stream: MoodStreamProcessor,
    pub mood: MoodVector,
    pub role: Role,
    pub turns: Vec<ConvTurn>,
}

impl MirandaSession {
    pub fn new() -> Self {
        Self {
            machine: StateMachine::new(),
            mood_stream: MoodStreamProcessor::new(),
            mood: MoodVector::NEUTRAL,
            role: Role::General,
            turns: Vec::new(),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    projects: Arc<Mutex<ProjectsStore>>,
    /// session_id → Miranda conversation state
    sessions: Arc<Mutex<HashMap<String, MirandaSession>>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub language: String,
    pub containerized: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct WriteFileRequest {
    pub project: String,
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct QwenGenerateRequest {
    pub prompt: String,
    pub model: Option<String>,
    pub max_tokens: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct MirandaTranscribeRequest {
    pub audio_b64: String,
}

#[derive(Debug, Deserialize)]
pub struct MirandaGenerateRequest {
    pub transcript: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MirandaSpeakRequest {
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateRepoRequest {
    pub project_name: String,
    pub github_token: Option<String>,
    pub hf_token: Option<String>,
    pub is_private: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

// ===== Project Management =====

async fn list_projects(State(state): State<AppState>) -> Json<ApiResponse<Vec<Project>>> {
    let projects = state.projects.lock().await;
    Json(ApiResponse {
        success: true,
        data: Some(projects.projects.clone()),
        error: None,
    })
}

async fn create_project(
    State(state): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> (StatusCode, Json<ApiResponse<Project>>) {
    let project_path = format!("{}/{}", projects_dir(), req.name);
    let containerized = req.containerized.unwrap_or(false);
    let podman_available = Command::new("podman").arg("--version").status().is_ok();

    if containerized && !podman_available {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some("Podman not found. Install with: sudo apt install podman".to_string()),
            }),
        );
    }

    if let Err(e) = fs::create_dir_all(&project_path) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some(format!("Failed to create directory: {}", e)),
            }),
        );
    }

    let status = Command::new("cargo")
        .arg("init")
        .arg("--name")
        .arg(&req.name)
        .arg(".")
        .current_dir(&project_path)
        .status();

    if status.is_err() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some("Failed to init Rust project".to_string()),
            }),
        );
    }

    let _ = Command::new("git").arg("init").current_dir(&project_path).status();
    let _ = Command::new("git")
        .arg("config").arg("user.name").arg("CRANE")
        .current_dir(&project_path).status();
    let _ = Command::new("git")
        .arg("config").arg("user.email").arg("crane@local")
        .current_dir(&project_path).status();

    if containerized {
        let _ = Command::new("podman")
            .arg("run").arg("--rm").arg("--userns=keep-id")
            .arg("-v").arg(format!("{}:/workspace", project_path))
            .arg("python:3.11-slim").arg("bash").arg("-c")
            .arg("cd /workspace && pip install -q uv && uv venv .venv && uv sync")
            .status();
    } else {
        let _ = Command::new("uv").arg("venv").arg(".venv").current_dir(&project_path).status();
        let _ = Command::new("uv").arg("sync").current_dir(&project_path).status();
    }

    let _ = Command::new("git").arg("add").arg("-A").current_dir(&project_path).status();
    let _ = Command::new("git")
        .arg("commit").arg("-m").arg("init: Create new Rust+Python project with UV")
        .current_dir(&project_path).status();

    let project = Project {
        name: req.name.clone(),
        language: "rust".to_string(),
        path: project_path,
        containerized,
        container_runtime: "podman".to_string(),
    };

    let mut store = state.projects.lock().await;
    store.projects.push(project.clone());
    store.save();

    (StatusCode::CREATED, Json(ApiResponse { success: true, data: Some(project), error: None }))
}

async fn health() -> Json<ApiResponse<serde_json::Value>> {
    let podman_ok = Command::new("podman").arg("--version").status().is_ok();
    let uv_ok = Command::new("uv").arg("--version").status().is_ok();
    let cargo_ok = Command::new("cargo").arg("--version").status().is_ok();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap_or_default();

    // Miranda's 3B brain (port 8003) — always-on, free, CPU/local GPU
    let miranda_3b = client.get("http://localhost:8003/v1/models").send().await
        .map(|r| r.status().is_success()).unwrap_or(false);
    // Qwen 14B (port 8000) — optional burst, user-triggered only
    let qwen_14b = client.get("http://localhost:8000/v1/models").send().await
        .map(|r| r.status().is_success()).unwrap_or(false);
    let qwen_coder = client.get("http://localhost:8001/v1/models").send().await
        .map(|r| r.status().is_success()).unwrap_or(false);
    let parakeet = client.get("http://localhost:8004/v1/models").send().await
        .map(|r| r.status().is_success()).unwrap_or(false);
    let tts = client.get("http://localhost:8005/health").send().await
        .map(|r| r.status().is_success()).unwrap_or(false);

    Json(ApiResponse {
        success: true,
        data: Some(serde_json::json!({
            "crane_home": crane_home(),
            "podman": podman_ok,
            "uv": uv_ok,
            "cargo": cargo_ok,
            "miranda_3b": miranda_3b,
            "qwen_14b_burst": qwen_14b,
            "qwen_coder": qwen_coder,
            "parakeet_asr": parakeet,
            "tts": tts,
        })),
        error: None,
    })
}

// ===== File Management =====

async fn get_file_tree(
    Query(params): Query<HashMap<String, String>>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    let project = match params.get("project") {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, Json(ApiResponse {
            success: false, data: None,
            error: Some("Missing project parameter".to_string()),
        })),
    };

    let project_path = format!("{}/{}", projects_dir(), project);

    fn build_tree(path: &std::path::Path, base: &std::path::Path, depth: usize) -> serde_json::Value {
        if depth > 5 {
            return serde_json::json!([]);
        }
        let mut items = vec![];
        if let Ok(entries) = fs::read_dir(path) {
            let mut entries: Vec<_> = entries.flatten().collect();
            entries.sort_by_key(|e| e.file_name());
            for entry in entries {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') || name == "target" { continue; }
                let relative = entry.path().strip_prefix(base)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| name.clone());
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        items.push(serde_json::json!({ "name": name, "type": "file", "path": relative }));
                    } else if meta.is_dir() {
                        items.push(serde_json::json!({
                            "name": name, "type": "dir", "path": relative,
                            "children": build_tree(&entry.path(), base, depth + 1)
                        }));
                    }
                }
            }
        }
        serde_json::json!(items)
    }

    let base = std::path::Path::new(&project_path);
    let tree = build_tree(base, base, 0);
    (StatusCode::OK, Json(ApiResponse { success: true, data: Some(serde_json::json!({ "tree": tree })), error: None }))
}

async fn read_file(
    Query(params): Query<HashMap<String, String>>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    let project = match params.get("project") {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, Json(ApiResponse {
            success: false, data: None, error: Some("Missing project parameter".to_string()),
        })),
    };
    let file_path = match params.get("path") {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, Json(ApiResponse {
            success: false, data: None, error: Some("Missing path parameter".to_string()),
        })),
    };

    // Prevent path traversal
    let root_str = projects_dir();
    let projects_root = std::path::Path::new(&root_str);
    let full_path = projects_root.join(project).join(file_path);
    if !full_path.starts_with(projects_root) {
        return (StatusCode::FORBIDDEN, Json(ApiResponse {
            success: false, data: None, error: Some("Access denied".to_string()),
        }));
    }

    match fs::read_to_string(&full_path) {
        Ok(content) => (StatusCode::OK, Json(ApiResponse {
            success: true,
            data: Some(serde_json::json!({ "path": file_path, "content": content })),
            error: None,
        })),
        Err(e) => (StatusCode::NOT_FOUND, Json(ApiResponse {
            success: false, data: None, error: Some(format!("File not found: {}", e)),
        })),
    }
}

async fn write_file(
    Json(req): Json<WriteFileRequest>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    let root_str = projects_dir();
    let projects_root = std::path::Path::new(&root_str);
    let full_path = projects_root.join(&req.project).join(&req.path);
    if !full_path.starts_with(projects_root) {
        return (StatusCode::FORBIDDEN, Json(ApiResponse {
            success: false, data: None, error: Some("Access denied".to_string()),
        }));
    }

    if let Some(parent) = full_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse {
                success: false, data: None, error: Some(format!("Failed to create directory: {}", e)),
            }));
        }
    }

    match fs::write(&full_path, &req.content) {
        Ok(_) => (StatusCode::OK, Json(ApiResponse { success: true, data: Some("File saved".to_string()), error: None })),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse {
            success: false, data: None, error: Some(format!("Failed to write file: {}", e)),
        })),
    }
}

// ===== Qwen LLM Routing =====

async fn qwen_generate(
    Json(req): Json<QwenGenerateRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    let model = req.model.unwrap_or_else(|| "qwen-14b".to_string());
    let max_tokens = req.max_tokens.unwrap_or(1000);

    let url = match model.as_str() {
        "qwen-14b" => "http://localhost:8000/v1/chat/completions",
        "qwen-coder" => "http://localhost:8001/v1/chat/completions",
        _ => return (StatusCode::BAD_REQUEST, Json(ApiResponse {
            success: false, data: None,
            error: Some("Unknown model. Use 'qwen-14b' or 'qwen-coder'".to_string()),
        })),
    };

    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "model": "qwen",
        "messages": [{"role": "user", "content": req.prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.7
    });

    match client.post(url).json(&payload).send().await {
        Ok(response) => match response.json::<serde_json::Value>().await {
            Ok(data) => {
                let text = data
                    .get("choices").and_then(|c| c.get(0))
                    .and_then(|c| c.get("message")).and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str()).unwrap_or("No response").to_string();
                (StatusCode::OK, Json(ApiResponse {
                    success: true,
                    data: Some(serde_json::json!({ "text": text, "model": model })),
                    error: None,
                }))
            }
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse {
                success: false, data: None, error: Some(format!("Failed to parse response: {}", e)),
            })),
        },
        Err(e) => (StatusCode::SERVICE_UNAVAILABLE, Json(ApiResponse {
            success: false, data: None,
            error: Some(format!("Qwen unavailable: {}. Is llama.cpp server running on 8000?", e)),
        })),
    }
}

// ===== Miranda Voice Routes (Phase 2 stubs — return 503 until servers are running) =====

async fn miranda_transcribe(
    Json(_req): Json<MirandaTranscribeRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    // Parakeet 110M ASR server wiring arrives in Phase 2.
    // Returns 503 so the frontend can surface a clear "ASR not ready" message.
    (StatusCode::SERVICE_UNAVAILABLE, Json(ApiResponse {
        success: false,
        data: None,
        error: Some("Parakeet ASR server not yet running on localhost:8004. Start with: llama-server -m <parakeet.gguf> --port 8004".to_string()),
    }))
}

async fn miranda_generate(
    State(state): State<AppState>,
    Json(req): Json<MirandaGenerateRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    let session_id = req.session_id.clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let user_text = req.transcript.trim().to_string();

    // ── 1. Load or create session state ──────────────────────────────────────
    let (system_prompt, history_messages) = {
        let mut sessions = state.sessions.lock().await;
        let session = sessions.entry(session_id.clone())
            .or_insert_with(MirandaSession::new);

        // ── 2. Update mood from this turn's text ──────────────────────────────
        session.mood = session.mood_stream.process_chunk(&user_text);

        // ── 3. Advance conversation state machine ─────────────────────────────
        let cue = detect_cue(&user_text);
        // Simple entity extraction: any token that looks like a tech term
        let entities: Vec<String> = user_text.split_whitespace()
            .filter(|w| w.len() > 4)
            .map(|w| w.to_lowercase())
            .collect();
        session.machine.transition(&session.mood, &entities, cue);
        let conv_state = session.machine.state;

        // ── 4. Detect role ────────────────────────────────────────────────────
        session.role = detect_role(&user_text, conv_state, &session.mood);

        // ── 5. Load recent memory context from JSONL ──────────────────────────
        let memory_path = format!("{}/.miranda/memory.jsonl", crane_home());
        let memory_context: Vec<RetrievedContext> = if std::path::Path::new(&memory_path).exists() {
            fs::read_to_string(&memory_path).unwrap_or_default()
                .lines()
                .rev()
                .take(5)
                .filter_map(|line| {
                    serde_json::from_str::<serde_json::Value>(line).ok()
                        .and_then(|v| v.get("user_message").and_then(|m| m.as_str()).map(|s| {
                            RetrievedContext { text: s.to_string() }
                        }))
                })
                .collect()
        } else {
            vec![]
        };

        // ── 6. Build system prompt via miranda-nodes ──────────────────────────
        let system_prompt = build_prompt(
            session.role,
            conv_state,
            &session.mood,
            &memory_context,
            &[],   // anticipatory moves — Phase 3
            None,  // partnership ack — Phase 3
            DEFAULT_TOKEN_BUDGET,
        );

        // ── 7. Build conversation history for LLM ────────────────────────────
        let history: Vec<serde_json::Value> = session.turns.iter()
            .flat_map(|t| vec![
                serde_json::json!({"role": "user", "content": t.user_text}),
                serde_json::json!({"role": "assistant", "content": t.miranda_text}),
            ])
            .collect();

        (system_prompt, history)
    };

    // ── 8. Call Miranda's brain (Qwen 3B abliterated, port 8003) ─────────────
    let client = reqwest::Client::new();
    let mut messages = vec![serde_json::json!({"role": "system", "content": system_prompt})];
    messages.extend(history_messages);
    messages.push(serde_json::json!({"role": "user", "content": user_text}));

    let payload = serde_json::json!({
        "model": "qwen",
        "messages": messages,
        "max_tokens": 800,
        "temperature": 0.8,
        "stream": false
    });

    match client.post("http://localhost:8003/v1/chat/completions").json(&payload).send().await {
        Ok(response) => match response.json::<serde_json::Value>().await {
            Ok(data) => {
                let text = data
                    .get("choices").and_then(|c| c.get(0))
                    .and_then(|c| c.get("message")).and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str()).unwrap_or("...").to_string();

                // ── 9. Persist turn to session state and JSONL memory ─────────
                {
                    let mut sessions = state.sessions.lock().await;
                    if let Some(session) = sessions.get_mut(&session_id) {
                        session.turns.push(ConvTurn {
                            user_text: user_text.clone(),
                            miranda_text: text.clone(),
                        });
                        // Keep last 20 turns in memory (don't grow forever)
                        if session.turns.len() > 20 {
                            session.turns.remove(0);
                        }
                    }
                }

                // Append to JSONL memory log (append-only, one line per turn)
                let memory_dir = format!("{}/.miranda", crane_home());
                let _ = fs::create_dir_all(&memory_dir);
                let memory_path = format!("{}/memory.jsonl", memory_dir);
                let event = serde_json::json!({
                    "event_id": uuid::Uuid::new_v4().to_string(),
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                    "session_id": session_id,
                    "user_message": user_text,
                    "miranda_response": text,
                });
                if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&memory_path) {
                    let _ = writeln!(f, "{}", serde_json::to_string(&event).unwrap_or_default());
                }

                (StatusCode::OK, Json(ApiResponse {
                    success: true,
                    data: Some(serde_json::json!({
                        "response": text,
                        "session_id": session_id,
                    })),
                    error: None,
                }))
            }
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse {
                success: false, data: None,
                error: Some(format!("Failed to parse Qwen response: {}", e)),
            })),
        },
        Err(e) => (StatusCode::SERVICE_UNAVAILABLE, Json(ApiResponse {
            success: false, data: None,
            error: Some(format!("Miranda brain (Qwen 3B) not reachable on localhost:8003 — start it with run.sh: {}", e)),
        })),
    }
}

async fn miranda_speak(
    Json(_req): Json<MirandaSpeakRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    // TTS server wiring arrives in Phase 2.
    (StatusCode::SERVICE_UNAVAILABLE, Json(ApiResponse {
        success: false,
        data: None,
        error: Some("TTS server not yet running on localhost:8005. Phase 2 wires VibeVoice/Parler.".to_string()),
    }))
}

async fn miranda_memory_search(
    Query(params): Query<HashMap<String, String>>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    let q = params.get("q").map(|s| s.as_str()).unwrap_or("");
    let memory_path = format!("{}/.miranda/memory.jsonl", crane_home());

    if !std::path::Path::new(&memory_path).exists() {
        return (StatusCode::OK, Json(ApiResponse {
            success: true,
            data: Some(serde_json::json!({ "results": [], "query": q })),
            error: None,
        }));
    }

    let results: Vec<serde_json::Value> = fs::read_to_string(&memory_path)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .filter(|entry: &serde_json::Value| {
            let haystack = entry.to_string().to_lowercase();
            q.split_whitespace().all(|word| haystack.contains(&word.to_lowercase()))
        })
        .take(10)
        .collect();

    (StatusCode::OK, Json(ApiResponse {
        success: true,
        data: Some(serde_json::json!({ "results": results, "query": q })),
        error: None,
    }))
}

// ===== GitHub / HuggingFace Integration =====

async fn create_github_repo(
    Json(req): Json<CreateRepoRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    let github_token = match req.github_token {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, Json(ApiResponse {
            success: false, data: None,
            error: Some("GitHub token required. Get from https://github.com/settings/tokens".to_string()),
        })),
    };

    let project_path = format!("{}/{}", projects_dir(), req.project_name);
    if !std::path::Path::new(&format!("{}/.git", project_path)).exists() {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse {
            success: false, data: None,
            error: Some("Project not initialized. Run create_project first".to_string()),
        }));
    }

    let visibility = if req.is_private.unwrap_or(false) { "private" } else { "public" };
    let output = Command::new("gh")
        .env("GH_TOKEN", &github_token)
        .args(["repo", "create", &req.project_name,
               &format!("--source={}", project_path),
               &format!("--visibility={}", visibility),
               "--remote=origin", "--push"])
        .output();

    match output {
        Ok(result) if result.status.success() => {
            (StatusCode::CREATED, Json(ApiResponse {
                success: true,
                data: Some(serde_json::json!({ "message": "GitHub repo created and pushed" })),
                error: None,
            }))
        }
        Ok(result) => (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse {
            success: false, data: None,
            error: Some(format!("gh CLI error: {}", String::from_utf8_lossy(&result.stderr))),
        })),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse {
            success: false, data: None,
            error: Some(format!("gh CLI not installed or failed: {}", e)),
        })),
    }
}

async fn create_hf_repo(
    Json(req): Json<CreateRepoRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    let hf_token = match req.hf_token {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, Json(ApiResponse {
            success: false, data: None,
            error: Some("HuggingFace token required".to_string()),
        })),
    };

    let client = reqwest::Client::new();
    let response = client
        .post("https://huggingface.co/api/repos/create")
        .header("Authorization", format!("Bearer {}", hf_token))
        .json(&serde_json::json!({
            "repo_id": req.project_name,
            "private": req.is_private.unwrap_or(true)
        }))
        .send()
        .await;

    match response {
        Ok(res) if res.status().is_success() => (StatusCode::CREATED, Json(ApiResponse {
            success: true,
            data: Some(serde_json::json!({ "message": "HuggingFace repo created" })),
            error: None,
        })),
        Ok(res) => (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse {
            success: false, data: None, error: Some(format!("HF API error: {}", res.status())),
        })),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse {
            success: false, data: None, error: Some(format!("Failed to reach HF API: {}", e)),
        })),
    }
}

// ===== Main =====

#[tokio::main]
async fn main() {
    let store = ProjectsStore::load();
    let state = AppState {
        projects: Arc::new(Mutex::new(store)),
        sessions: Arc::new(Mutex::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/projects", get(list_projects))
        .route("/api/projects/create", post(create_project))
        .route("/api/files/tree", get(get_file_tree))
        .route("/api/files/read", get(read_file))
        .route("/api/files/write", post(write_file))
        .route("/api/qwen/generate", post(qwen_generate))
        // Miranda voice routes (Phase 2 stubs — real wiring soon)
        .route("/api/miranda/transcribe", post(miranda_transcribe))
        .route("/api/miranda/generate", post(miranda_generate))
        .route("/api/miranda/speak", post(miranda_speak))
        .route("/api/miranda/memory/search", get(miranda_memory_search))
        // Repos
        .route("/api/repos/github/create", post(create_github_repo))
        .route("/api/repos/hf/create", post(create_hf_repo))
        .with_state(state)
        .layer(tower_http::cors::CorsLayer::permissive());

    let port = std::env::var("CRANE_BACKEND_PORT")
        .ok().and_then(|s| s.parse::<u16>().ok()).unwrap_or(8002);
    let addr = format!("127.0.0.1:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await
        .expect("Failed to bind backend port");

    println!("🏗️  CRANE Backend v2.0 — Miranda Ready");
    println!("═══════════════════════════════════════════════");
    println!("   CRANE_HOME:     {}", crane_home());
    println!("   Projects:       {}", projects_dir());
    println!("   Miranda brain:  localhost:8003 (Qwen 3B abliterated, always-on)");
    println!("   Qwen Coder:     localhost:8001 (tool-use)");
    println!("   Qwen 14B burst: localhost:8000 (user-triggered only)");
    println!("   Parakeet ASR:   localhost:8004 (Phase 2)");
    println!("   TTS:            localhost:8005 (Phase 2)");
    println!("   Listening:      http://{}", addr);

    axum::serve(listener, app).await.unwrap();
}
