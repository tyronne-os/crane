#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

/// Returns the CRANE_HOME directory so the frontend can display it.
/// Defaults to ~/crane-projects if the env var is not set.
#[tauri::command]
fn get_crane_home() -> String {
    std::env::var("CRANE_HOME").unwrap_or_else(|_| {
        dirs_next::home_dir()
            .map(|h| h.join("crane-projects").to_string_lossy().into_owned())
            .unwrap_or_else(|| "/tmp/crane-projects".to_string())
    })
}

/// Returns the CRANE backend port (default 8002). Frontend uses this to
/// build its API base URL — keeps the port in one place.
#[tauri::command]
fn get_backend_port() -> u16 {
    std::env::var("CRANE_BACKEND_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8002)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // In dev mode, open DevTools on the main window automatically.
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_crane_home, get_backend_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
