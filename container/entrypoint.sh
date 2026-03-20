#!/bin/bash
set -e

# THE ROOT TAKEOVER
export HOME=/root
export GEMINI_HOME=/root/.gemini
# Ensure directory exists (will be used by bind mounts)
mkdir -p $GEMINI_HOME

# Navigate to app directory for setup check
cd /app

# Ensure dist directory exists (legacy compatibility)
mkdir -p /tmp/dist
ln -sf /app/node_modules /tmp/dist/node_modules

# ENFORCE CWD: Switch to workspace for agent execution
cd /workspace

# Execute the agent
cat > /tmp/input.json
node /app/dist/index.js < /tmp/input.json
