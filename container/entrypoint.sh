#!/bin/bash
set -e

echo "DEBUG: entrypoint.sh started" >&2
echo "DEBUG: UID is $(id -u)" >&2

if [ -d "/app/src_mount" ]; then
    echo "DEBUG: linking src_mount" >&2
    ln -sf /app/src_mount /app/src
fi

if [ -d "/app/src" ] && [ -w "/app" ]; then
    echo "DEBUG: Compiling agent runner..." >&2
    cd /app && /app/node_modules/.bin/tsc --outDir /tmp/dist 2>&1 >&2
    ln -sf /app/node_modules /tmp/dist/node_modules
    export RUN_DIR="/tmp/dist"
else
    echo "DEBUG: Using pre-built runner" >&2
    export RUN_DIR="/app/dist"
fi

echo "DEBUG: reading stdin" >&2
cat > /tmp/input.json
echo "DEBUG: received $(wc -c < /tmp/input.json) bytes" >&2

echo "DEBUG: starting node" >&2
# Capture all output
HOME=/root node ${RUN_DIR}/index.js < /tmp/input.json 2>&1 | tee /tmp/all_output.log

echo "DEBUG: node finished with code $?" >&2
# Echo the last line of the actual stdout if it was JSON
# But the runner should have already handled that.
