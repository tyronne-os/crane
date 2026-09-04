#!/bin/bash

# Start CRANE
# This script:
# 1. Starts the Rust backend (project manager)
# 2. Starts the React frontend (Tauri window)
# 3. Manages Podman/Docker container lifecycle

PROJECT_ROOT="/mnt/NOBILITY_VAULT/crane-ide"
cd "$PROJECT_ROOT"

echo "🏗️  Starting CRANE..."

# Start backend (Rust)
echo "Starting backend (port 8002)..."
cd backend && cargo run --release &
BACKEND_PID=$!
cd ..

# Wait for backend to be ready
sleep 2

# Start frontend (Tauri window)
echo "Starting frontend..."
cd src-tauri/frontend && npm run dev &
FRONTEND_PID=$!

# Wait for signals
trap "kill $BACKEND_PID $FRONTEND_PID" EXIT

wait
