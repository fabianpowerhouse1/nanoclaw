#!/bin/bash
set -e

# Support Non-Root Users (V1.1 Fix)
if [ "$(id -u)" = "0" ]; then
    export HOME=/root
else
    # HOME is typically passed by Docker -e HOME or defaults to /home/node
    export HOME="${HOME:-/home/node}"
fi

export GEMINI_HOME="$HOME/.gemini"
# Ensure directory exists (will be used by bind mounts)
mkdir -p "$GEMINI_HOME"

# Navigate to app directory for setup check
cd /app

# Ensure dist directory exists (legacy compatibility)
mkdir -p /tmp/dist
ln -sf /app/node_modules /tmp/dist/node_modules || true

# ENFORCE CWD: Switch to workspace for agent execution
cd /workspace

# Execute the agent
cat > /tmp/input.json
node /app/dist/index.js < /tmp/input.json
