# 🏗️ Qwen Kiro IDE

**Desktop IDE** for local Rust+Python development, powered by Qwen LLMs.

**Features:**
- ✅ Desktop app with construction crane icon 🏗️
- ✅ Splash screen: Recent projects or Create New
- ✅ Auto venv with UV (fast Python package manager)
- ✅ Default: Rust + Python (with UV)
- ✅ Containerized with Podman (safer, rootless) or Docker
- ✅ No npm unless cloning projects
- ✅ Full file system access to `/mnt/NOBILITY_VAULT/`
- ✅ Auto git init on every project

---

## Quick Start

### 1. Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install UV (fast venv manager)
pip install uv

# Install Podman (safer than Docker)
sudo apt install podman

# Optional: Docker (fallback)
sudo apt install docker.io
```

### 2. Build & Run

```bash
cd /mnt/NOBILITY_VAULT/qwen-kiro-ide

# Build Rust backend
cargo build --release

# Start IDE
./run.sh
```

**Expected output:**
```
🏗️  Starting Qwen Kiro IDE...
Starting backend (port 8002)...
Starting frontend...
```

### 3. Desktop Icon

The app creates a `.desktop` icon automatically:

```bash
# Icon location
~/.local/share/applications/qwen-kiro.desktop

# Click on desktop (or launcher) to open
# It will show: 🏗️ Qwen Kiro IDE
```

---

## How It Works

### Splash Screen (First View)

**If projects exist:**
```
🏗️ Qwen Kiro IDE
────────────────
Recent Projects:
  [my-app] [rust] 💻 local
  [web]    [rust] 📦 podman
  
✨ New Project
```

**Click a project** → Opens it (workspace not yet wired)
**Click "+ New Project"** → Shows creation form

### Create New Project

**Form options:**
```
Project name: ___________

☐ Containerized (Podman/Docker)

When checked, select runtime:
  🔒 Podman (safer, rootless) — DEFAULT
  🐳 Docker (fallback)

[✅ Create] [Cancel]
```

**On submit:**
1. Creates `/mnt/NOBILITY_VAULT/projects/{name}/`
2. Runs `cargo init --name {name}`
3. Initializes `git`
4. Creates UV venv: `.venv/`
5. If containerized: Builds Podman image + runs container
6. Auto-commits: `init: Create new Rust+Python project with UV`
7. Back to splash screen with new project visible

---

## Architecture

### Backend (Rust, Axum)

```
/api/health → Check Podman/Docker/UV status
/api/projects → List all projects
/api/projects/create → Create new project (with containerization)
```

**Auto-detects:**
- Podman (preferred) → rootless, safer
- Docker (fallback) → if Podman not found
- UV → for venv management

### Frontend (React, Tauri)

**Single splash view:**
- Recent projects (scrollable list)
- Create button → modal form
- Containerization toggle
- Runtime selector (Podman | Docker)

**Tech stack:**
- React 18 (minimal, no extra deps)
- Tauri (native window, no Electron bloat)
- No npm in default workflow (only if cloning)

### Container Support (Podman/Docker)

**Containerfile (Podman native):**
```dockerfile
FROM rust:latest
RUN apt-get install -y python3.11 git uv
WORKDIR /workspace
```

**Benefits of Podman over Docker:**
- Rootless by default (no daemon, safer)
- Direct mount of `/dev/shm` for IPC
- Drop-in Docker replacement
- OCI-compatible

---

## File Structure

```
/mnt/NOBILITY_VAULT/qwen-kiro-ide/
├── Cargo.toml (workspace: backend + Tauri)
├── backend/
│   ├── Cargo.toml (Axum server)
│   └── src/main.rs (project manager, containerization logic)
├── src-tauri/
│   ├── frontend/
│   │   ├── src/main.jsx (splash + create form)
│   │   ├── vite.config.js
│   │   └── package.json (React only, minimal)
│   └── src/main.rs (Tauri app shell)
├── .qwen-kiro/
│   ├── containers/
│   │   ├── Containerfile (Podman recipe)
│   │   └── podman-run.sh (launch container)
│   └── init-project.sh (local venv setup)
├── run.sh (launcher: start backend + frontend)
├── README.md (this file)
└── .desktop (icon for application launcher)
```

---

## Usage Workflow

### Local Rust Project (Default)

```bash
# Open Qwen Kiro IDE
# → Click "+ New Project"
# → Name: "my-app"
# → Uncheck "Containerized"
# → Click "Create"

# Result:
/mnt/NOBILITY_VAULT/projects/my-app/
├── .git/
├── .venv/            # UV Python venv
├── Cargo.toml
├── Cargo.lock
└── src/
    └── main.rs
```

**Develop:**
```bash
cd /mnt/NOBILITY_VAULT/projects/my-app
cargo build
cargo run

# For Python:
source .venv/bin/activate
pip install <package>
uv sync
```

### Containerized Rust+Python Project

```bash
# Open Qwen Kiro IDE
# → Click "+ New Project"
# → Name: "web-app"
# → Check "Containerized"
# → Select "🔒 Podman (safer, rootless)"
# → Click "Create"

# Result:
/mnt/NOBILITY_VAULT/projects/web-app/
├── .git/
├── Containerfile     # Auto-created for Podman
├── Cargo.toml
└── src/main.rs
```

**Run in container:**
```bash
cd /mnt/NOBILITY_VAULT/qwen-kiro-ide
./podman-run.sh web-app

# Inside container:
# $ cargo build
# $ source .venv/bin/activate
```

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Create new project | Ctrl+Shift+N |
| Open recent project | Click in list |
| Toggle containerization | Click checkbox |

---

## Troubleshooting

**"Podman not found"**
```bash
sudo apt install podman
```

**"UV not installed"**
```bash
pip install uv
```

**Desktop icon not appearing?**
```bash
# Update desktop DB
update-desktop-database ~/.local/share/applications/

# Or try opening directly:
/mnt/NOBILITY_VAULT/qwen-kiro-ide/run.sh
```

**Backend fails to start?**
```bash
# Check port 8002 is free
lsof -i :8002

# Or use a different port (edit backend/src/main.rs)
```

---

## Next Steps

1. **Test splash screen**: Create 2-3 test projects
2. **Test containerization**: Create one local, one Podman
3. **Wire workspace editor**: Click project → open file editor
4. **Integrate Qwen routing**: Wire backend to Qwen 14B/Coder models
5. **Add GitHub/HF sync**: Auto-create repos on project init

---

## Architecture Notes

- **No npm in default workflow** ✅ (only for cloning existing web projects)
- **Rust first** ✅ (all projects default to Rust)
- **Podman preferred** ✅ (safer, rootless)
- **UV for venv** ✅ (100x faster than pip alone)
- **Full filesystem access** ✅ (ALLOWED_ROOTS in backend)
- **Desktop icon** ✅ (construction crane 🏗️ via .desktop file)

---

**Built with 🦀 Rust + 🧠 Qwen + 🔒 Podman**
