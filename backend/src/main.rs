use axum::{
    extract::Json,
    http::StatusCode,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use tokio::sync::Mutex;
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub name: String,
    pub language: String,
    pub path: String,
    pub containerized: bool,
    pub container_runtime: String, // "podman" or "docker"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectsStore {
    pub projects: Vec<Project>,
}

pub struct AppState {
    projects: Arc<Mutex<ProjectsStore>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub language: String,
    pub containerized: Option<bool>,
    pub container_runtime: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

async fn list_projects(state: axum::extract::State<AppState>) -> Json<ApiResponse<Vec<Project>>> {
    let projects = state.projects.lock().await;
    Json(ApiResponse {
        success: true,
        data: Some(projects.projects.clone()),
        error: None,
    })
}

async fn create_project(
    state: axum::extract::State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> (StatusCode, Json<ApiResponse<Project>>) {
    let project_path = format!("/mnt/NOBILITY_VAULT/projects/{}", req.name);
    let containerized = req.containerized.unwrap_or(false);
    let container_runtime = req.container_runtime.unwrap_or_else(|| {
        // Check for podman first (safer), fallback to docker
        if Command::new("podman").arg("--version").status().is_ok() {
            "podman".to_string()
        } else if Command::new("docker").arg("--version").status().is_ok() {
            "docker".to_string()
        } else {
            "none".to_string()
        }
    });

    // Create project directory
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
    let _ = Command::new("git")
        .arg("init")
        .current_dir(&project_path)
        .status();
    let _ = Command::new("git")
        .arg("config")
        .arg("user.name")
        .arg("Qwen Kiro")
        .current_dir(&project_path)
        .status();
    let _ = Command::new("git")
        .arg("config")
        .arg("user.email")
        .arg("kiro@local")
        .current_dir(&project_path)
        .status();

    // Create UV venv if containerized
    if containerized && container_runtime != "none" {
        let mut cmd = if container_runtime == "podman" {
            let mut c = Command::new("podman");
            c.arg("run")
                .arg("--rm")
                .arg("-v")
                .arg(format!("{}:/workspace", project_path))
                .arg("python:3.11-slim");
            c
        } else {
            let mut c = Command::new("docker");
            c.arg("run")
                .arg("--rm")
                .arg("-v")
                .arg(format!("{}:/workspace", project_path))
                .arg("python:3.11-slim");
            c
        };

        cmd.arg("bash")
            .arg("-c")
            .arg("cd /workspace && pip install uv && uv venv .venv && uv sync");

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

    // Add initial commit
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
        language: req.language,
        path: project_path,
        containerized,
        container_runtime,
    };

    // Add to projects list
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
    let docker_ok = Command::new("docker").arg("--version").status().is_ok();
    let uv_ok = Command::new("uv").arg("--version").status().is_ok();

    let runtime = if podman_ok {
        "podman (primary)"
    } else if docker_ok {
        "docker (fallback)"
    } else {
        "none"
    };

    Json(ApiResponse {
        success: true,
        data: Some(format!(
            "Container runtime: {}, UV: {}",
            runtime,
            if uv_ok { "ok" } else { "missing" }
        )),
        error: None,
    })
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

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

    println!("🏗️  Qwen Kiro Backend listening on http://127.0.0.1:8002");
    println!("   Container runtime: podman (preferred) or docker (fallback)");
    println!("   Projects: /mnt/NOBILITY_VAULT/projects/");

    axum::serve(listener, app).await.unwrap();
}
