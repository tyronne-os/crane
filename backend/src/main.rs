use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
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
    pub container_runtime: String, // Always "podman"
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

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

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

    // Initialize Rust project
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

    // Initialize git
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

    // Create UV venv (local or containerized)
    if containerized {
        // Run inside Podman container (rootless)
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
        // Local venv with UV
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

    // Auto-commit
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

    Json(ApiResponse {
        success: true,
        data: Some(format!(
            "Podman: {}, UV: {}, Cargo: {}",
            if podman_ok { "ok" } else { "not installed" },
            if uv_ok { "ok" } else { "missing" },
            if cargo_ok { "ok" } else { "missing" }
        )),
        error: None,
    })
}

#[tokio::main]
async fn main() {
    let state = AppState {
        projects: Arc::new(Mutex::new(ProjectsStore {
            projects: vec![],
        })),
    };

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/projects", get(list_projects))
        .route("/api/projects/create", post(create_project))
        .with_state(state)
        .layer(tower_http::cors::CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8002")
        .await
        .expect("Failed to bind to 127.0.0.1:8002");

    println!("🏗️  CRANE Backend listening on http://127.0.0.1:8002");
    println!("   Container runtime: Podman (rootless, safer)");
    println!("   Projects: /mnt/NOBILITY_VAULT/projects/");
    println!("");
    println!("   GET  /api/health");
    println!("   GET  /api/projects");
    println!("   POST /api/projects/create (with optional containerized: true)");

    axum::serve(listener, app).await.unwrap();
}
