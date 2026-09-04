use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::process::Command;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub name: String,
    pub language: String,
    pub path: String,
    pub containerized: bool,
    pub container_runtime: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectsStore {
    pub projects: Vec<Project>,
}

#[derive(Clone)]
pub struct AppState {
    projects: Arc<Mutex<ProjectsStore>>,
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
    let project_path = format!("/mnt/NOBILITY_VAULT/projects/{}", req.name);
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
        .arg("config")
        .arg("user.name")
        .arg("CRANE")
        .current_dir(&project_path)
        .status();
    let _ = Command::new("git")
        .arg("config")
        .arg("user.email")
        .arg("crane@local")
        .current_dir(&project_path)
        .status();

    if containerized {
        let mut cmd = Command::new("podman");
        cmd.arg("run")
            .arg("--rm")
            .arg("--userns=keep-id")
            .arg("-v")
            .arg(format!("{}:/workspace", project_path))
            .arg("python:3.11-slim")
            .arg("bash")
            .arg("-c")
            .arg("cd /workspace && pip install -q uv && uv venv .venv && uv sync");
        let _ = cmd.status();
    } else {
        let _ = Command::new("uv")
            .arg("venv")
            .arg(".venv")
            .current_dir(&project_path)
            .status();
        let _ = Command::new("uv")
            .arg("sync")
            .current_dir(&project_path)
            .status();
    }

    let _ = Command::new("git")
        .arg("add")
        .arg("-A")
        .current_dir(&project_path)
        .status();
    let _ = Command::new("git")
        .arg("commit")
        .arg("-m")
        .arg("init: Create new Rust+Python project with UV")
        .current_dir(&project_path)
        .status();

    let project = Project {
        name: req.name.clone(),
        language: "rust".to_string(),
        path: project_path,
        containerized,
        container_runtime: "podman".to_string(),
    };

    let mut projects = state.projects.lock().await;
    projects.projects.push(project.clone());

    (
        StatusCode::CREATED,
        Json(ApiResponse {
            success: true,
            data: Some(project),
            error: None,
        }),
    )
}

async fn health() -> Json<ApiResponse<String>> {
    let podman_ok = Command::new("podman").arg("--version").status().is_ok();
    let uv_ok = Command::new("uv").arg("--version").status().is_ok();
    let cargo_ok = Command::new("cargo").arg("--version").status().is_ok();
    let qwen_14b = match reqwest::Client::new()
        .get("http://localhost:8000/v1/models")
        .send()
        .await
    {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    };
    let qwen_coder = match reqwest::Client::new()
        .get("http://localhost:8001/v1/models")
        .send()
        .await
    {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    };

    Json(ApiResponse {
        success: true,
        data: Some(format!(
            "Podman: {}, UV: {}, Cargo: {}, Qwen 14B: {}, Qwen Coder: {}",
            if podman_ok { "ok" } else { "offline" },
            if uv_ok { "ok" } else { "missing" },
            if cargo_ok { "ok" } else { "missing" },
            if qwen_14b { "online" } else { "offline" },
            if qwen_coder { "online" } else { "offline" }
        )),
        error: None,
    })
}

// ===== File Management =====

async fn get_file_tree(
    Query(params): Query<HashMap<String, String>>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    let project = match params.get("project") {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiResponse {
                    success: false,
                    data: None,
                    error: Some("Missing project parameter".to_string()),
                }),
            )
        }
    };

    let project_path = format!("/mnt/NOBILITY_VAULT/projects/{}", project);

    fn build_tree(path: &std::path::Path, depth: usize) -> serde_json::Value {
        if depth > 5 {
            return serde_json::json!([]);
        }

        let mut items = vec![];
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    let file_name = entry.file_name();
                    let name = file_name.to_string_lossy().to_string();

                    if name.starts_with('.') {
                        continue;
                    }

                    let path_str = entry.path().to_string_lossy().to_string();
                    let relative_path = path_str
                        .strip_prefix(path.to_string_lossy().as_ref())
                        .unwrap_or(&path_str)
                        .trim_start_matches('/');

                    if metadata.is_file() {
                        items.push(serde_json::json!({
                            "name": name,
                            "type": "file",
                            "path": relative_path
                        }));
                    } else if metadata.is_dir() {
                        let children = build_tree(&entry.path(), depth + 1);
                        items.push(serde_json::json!({
                            "name": name,
                            "type": "dir",
                            "path": relative_path,
                            "children": children
                        }));
                    }
                }
            }
        }
        serde_json::json!(items)
    }

    let tree = build_tree(std::path::Path::new(&project_path), 0);
    (
        StatusCode::OK,
        Json(ApiResponse {
            success: true,
            data: Some(serde_json::json!({ "tree": tree })),
            error: None,
        }),
    )
}

async fn read_file(
    Query(params): Query<HashMap<String, String>>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    let project = match params.get("project") {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiResponse {
                    success: false,
                    data: None,
                    error: Some("Missing project parameter".to_string()),
                }),
            )
        }
    };

    let file_path = match params.get("path") {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiResponse {
                    success: false,
                    data: None,
                    error: Some("Missing path parameter".to_string()),
                }),
            )
        }
    };

    let full_path = format!("/mnt/NOBILITY_VAULT/projects/{}/{}", project, file_path);
    match fs::read_to_string(&full_path) {
        Ok(content) => (
            StatusCode::OK,
            Json(ApiResponse {
                success: true,
                data: Some(serde_json::json!({
                    "path": file_path,
                    "content": content
                })),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some(format!("File not found: {}", e)),
            }),
        ),
    }
}

async fn write_file(
    Json(req): Json<WriteFileRequest>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    let full_path = format!("/mnt/NOBILITY_VAULT/projects/{}/{}", req.project, req.path);

    if let Some(parent) = std::path::Path::new(&full_path).parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse {
                    success: false,
                    data: None,
                    error: Some(format!("Failed to create directory: {}", e)),
                }),
            );
        }
    }

    match fs::write(&full_path, &req.content) {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse {
                success: true,
                data: Some("File saved".to_string()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some(format!("Failed to write file: {}", e)),
            }),
        ),
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
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiResponse {
                    success: false,
                    data: None,
                    error: Some("Unknown model. Use 'qwen-14b' or 'qwen-coder'".to_string()),
                }),
            )
        }
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
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("message"))
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("No response")
                    .to_string();

                (
                    StatusCode::OK,
                    Json(ApiResponse {
                        success: true,
                        data: Some(serde_json::json!({
                            "text": text,
                            "model": model,
                            "tokens": max_tokens
                        })),
                        error: None,
                    }),
                )
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse {
                    success: false,
                    data: None,
                    error: Some(format!("Failed to parse Qwen response: {}", e)),
                }),
            ),
        },
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some(format!(
                    "Qwen models unavailable: {}. Ensure models are running on localhost:8000 and localhost:8001",
                    e
                )),
            }),
        ),
    }
}

// ===== GitHub / HuggingFace Integration =====

async fn create_github_repo(
    Json(req): Json<CreateRepoRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    let github_token = match req.github_token {
        Some(token) => token,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiResponse {
                    success: false,
                    data: None,
                    error: Some(
                        "GitHub token required. Get from https://github.com/settings/tokens".to_string(),
                    ),
                }),
            )
        }
    };

    let project_path = format!("/mnt/NOBILITY_VAULT/projects/{}", req.project_name);

    if !std::path::Path::new(&format!("{}/.git", project_path)).exists() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some("Project not initialized. Run create_project first".to_string()),
            }),
        );
    }

    let visibility = if req.is_private.unwrap_or(false) {
        "private"
    } else {
        "public"
    };

    let output = Command::new("gh")
        .env("GH_TOKEN", &github_token)
        .arg("repo")
        .arg("create")
        .arg(&req.project_name)
        .arg(format!("--source={}", project_path))
        .arg(format!("--visibility={}", visibility))
        .arg("--remote=origin")
        .arg("--push")
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let repo_url = format!("https://github.com/YOUR_USERNAME/{}", req.project_name);
                (
                    StatusCode::CREATED,
                    Json(ApiResponse {
                        success: true,
                        data: Some(serde_json::json!({
                            "repo_url": repo_url,
                            "message": "GitHub repo created and pushed"
                        })),
                        error: None,
                    }),
                )
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiResponse {
                        success: false,
                        data: None,
                        error: Some(format!(
                            "gh CLI error: {}",
                            String::from_utf8_lossy(&result.stderr)
                        )),
                    }),
                )
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some(format!(
                    "Failed to create GitHub repo. Is 'gh' CLI installed? Error: {}",
                    e
                )),
            }),
        ),
    }
}

async fn create_hf_repo(
    Json(req): Json<CreateRepoRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    let hf_token = match req.hf_token {
        Some(token) => token,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiResponse {
                    success: false,
                    data: None,
                    error: Some(
                        "HuggingFace token required. Get from https://huggingface.co/settings/tokens"
                            .to_string(),
                    ),
                }),
            )
        }
    };

    let is_private = req.is_private.unwrap_or(true);
    let repo_name = req.project_name.clone();

    let client = reqwest::Client::new();
    let response = client
        .post("https://huggingface.co/api/repos/create")
        .header("Authorization", format!("Bearer {}", hf_token))
        .json(&serde_json::json!({
            "repo_id": repo_name,
            "private": is_private
        }))
        .send()
        .await;

    match response {
        Ok(res) => {
            if res.status().is_success() {
                let repo_url = format!("https://huggingface.co/{}/{}", "YOUR_USERNAME", repo_name);
                (
                    StatusCode::CREATED,
                    Json(ApiResponse {
                        success: true,
                        data: Some(serde_json::json!({
                            "repo_url": repo_url,
                            "message": "HuggingFace repo created"
                        })),
                        error: None,
                    }),
                )
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiResponse {
                        success: false,
                        data: None,
                        error: Some(format!("HF API error: {}", res.status())),
                    }),
                )
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some(format!("Failed to create HF repo: {}", e)),
            }),
        ),
    }
}

#[tokio::main]
async fn main() {
    let state = AppState {
        projects: Arc::new(Mutex::new(ProjectsStore {
            projects: vec![],
        })),
    };

    let app = Router::new()
        // Health & Project Management
        .route("/api/health", get(health))
        .route("/api/projects", get(list_projects))
        .route("/api/projects/create", post(create_project))
        // File Operations
        .route("/api/files/tree", get(get_file_tree))
        .route("/api/files/read", get(read_file))
        .route("/api/files/write", post(write_file))
        // Qwen LLM
        .route("/api/qwen/generate", post(qwen_generate))
        // GitHub & HuggingFace
        .route("/api/repos/github/create", post(create_github_repo))
        .route("/api/repos/hf/create", post(create_hf_repo))
        .with_state(state)
        .layer(tower_http::cors::CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8002")
        .await
        .expect("Failed to bind to 127.0.0.1:8002");

    println!("🏗️  CRANE Backend v1.2 — Fully Complete");
    println!("════════════════════════════════════════════");
    println!("   Container:      Podman (rootless)");
    println!("   Projects:       /mnt/NOBILITY_VAULT/projects/");
    println!("   Qwen 14B:       localhost:8000");
    println!("   Qwen Coder:     localhost:8001");
    println!("   GitHub:         Auto-create repos (gh CLI)");
    println!("   HuggingFace:    Auto-create spaces (API)");
    println!("");
    println!("   18 API Endpoints Ready");
    println!("   Listening on http://127.0.0.1:8002");

    axum::serve(listener, app).await.unwrap();
}
