use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
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
    pub container_runtime: Option<String>,
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
    let container_runtime = req.container_runtime.unwrap_or_else(|| {
        if Command::new("podman").arg("--version").status().is_ok() {
            "podman".to_string()
        } else if Command::new("docker").arg("--version").status().is_ok() {
            "docker".to_string()
        } else {
            "none".to_string()
        }
    });

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

    let _ = Command::new("git")
        .arg("init")
        .current_dir(&project_path)
        .status();
    let _ = Command::new("git")
        .arg("config")
        .arg("user.name")
        .arg("CRANE")
        .current_dir(&project_path)
        .status();
    let _ = Command::new("git")
        .arg("config")
        .arg("user.email")
        .arg("kiro@local")
        .current_dir(&project_path)
        .status();

    if containerized && container_runtime != "none" {
        let runtime_cmd = if container_runtime == "podman" { "podman" } else { "docker" };
        let mut cmd = Command::new(runtime_cmd);
        cmd.arg("run")
            .arg("--rm")
            .arg("-v")
            .arg(format!("{}:/workspace", project_path))
            .arg("python:3.11-slim")
            .arg("bash")
            .arg("-c")
            .arg("cd /workspace && pip install uv && uv venv .venv && uv sync");
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
        language: req.language,
        path: project_path,
        containerized,
        container_runtime,
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
    let docker_ok = Command::new("docker").arg("--version").status().is_ok();
    let uv_ok = Command::new("uv").arg("--version").status().is_ok();
    let cargo_ok = Command::new("cargo").arg("--version").status().is_ok();

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
            "Runtime: {}, UV: {}, Cargo: {}",
            runtime,
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

    println!("🏗️  Crane Backend listening on http://127.0.0.1:8002");
    println!("   GET  /api/health");
    println!("   GET  /api/projects");
    println!("   POST /api/projects/create");

    axum::serve(listener, app).await.unwrap();
}
