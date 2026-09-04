#!/bin/bash
# Auto-init new Rust project with UV venv

PROJECT_NAME=$1
PROJECT_PATH="/mnt/NOBILITY_VAULT/projects/${PROJECT_NAME}"

if [ -z "$PROJECT_NAME" ]; then
  echo "Usage: init-project.sh <project-name>"
  exit 1
fi

mkdir -p "$PROJECT_PATH"
cd "$PROJECT_PATH"

# Initialize Rust project
cargo init --name "$PROJECT_NAME"

# Initialize UV venv (Python)
uv venv .venv
uv sync

# Initialize git
git init
git config user.name "Qwen Kiro"
git config user.email "kiro@local"
git add .
git commit -m "init: Create new Rust+Python project"

echo "✓ Project initialized: $PROJECT_PATH"
echo "  Rust: cargo build"
echo "  Python: source .venv/bin/activate"
