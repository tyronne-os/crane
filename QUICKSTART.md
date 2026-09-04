# Quick Start — 5 Minutes

## Step 1: Install Dependencies (2 min)

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# UV (fast venv manager)
pip install uv

# Podman (safer container runtime)
sudo apt install podman
```

## Step 2: Build Backend (2 min)

```bash
cd /mnt/NOBILITY_VAULT/qwen-kiro-ide
cargo build --release
```

## Step 3: Run (1 min)

```bash
./run.sh
```

**You should see:**
```
🏗️  Starting Qwen Kiro IDE...
Starting backend (port 8002)...
Starting frontend...
```

**A window appears with:**
- 🏗️ icon (construction crane)
- "Qwen Kiro IDE" title
- "✨ New Project" button (or recent projects if any exist)

## Step 4: Create Test Project (1 min)

Click **"✨ New Project"**

Fill form:
```
Project name: my-test-app
☐ Containerized
[✅ Create]
```

**Result:** 
- Project created at `/mnt/NOBILITY_VAULT/projects/my-test-app/`
- Rust project initialized (cargo)
- Git repo initialized
- UV venv created
- Back to splash screen

## Done ✓

You now have a working Qwen Kiro IDE with:
- ✅ Splash screen showing projects
- ✅ Create new project (local or Podman)
- ✅ Auto venv with UV
- ✅ Rust default (Python optional)
- ✅ Desktop icon (🏗️)

**Next:** Wire up editor workspace, Qwen routing, GitHub/HF sync.
