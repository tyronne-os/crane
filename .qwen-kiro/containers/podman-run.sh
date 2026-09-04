#!/bin/bash
# Run project in Podman container

PROJECT_NAME=$1
PROJECT_PATH="/mnt/NOBILITY_VAULT/projects/${PROJECT_NAME}"

if [ -z "$PROJECT_NAME" ]; then
  echo "Usage: podman-run.sh <project-name>"
  exit 1
fi

# Build container image
podman build -t "qwen-kiro-${PROJECT_NAME}:latest" \
  -f .qwen-kiro/containers/Containerfile \
  "${PROJECT_PATH}"

# Run container (rootless, safer)
podman run -it --rm \
  -v "${PROJECT_PATH}:/workspace" \
  -p 8000:8000 \
  -p 8001:8001 \
  -p 8002:8002 \
  --userns=keep-id \
  "qwen-kiro-${PROJECT_NAME}:latest"
