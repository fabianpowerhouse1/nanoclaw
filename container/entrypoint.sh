#!/bin/bash
set -e
# Navigate to app directory
cd /app
# Ensure dist directory exists in tmp
mkdir -p /tmp/dist
# Compile the agent-runner (if needed)
[ -f /app/node_modules/.bin/tsc ] && /app/node_modules/.bin/tsc --outDir /tmp/dist 2>&1 >&2 || true
# Link node_modules
ln -sf /app/node_modules /tmp/dist/node_modules
# Execute the agent
cat > /tmp/input.json
HOME=/root node /tmp/dist/index.js < /tmp/input.json
