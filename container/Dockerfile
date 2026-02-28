# NanoClaw Agent Container
# Runs Claude Agent SDK or Gemini CLI in isolated Linux VM

FROM node:22-slim

# Install system dependencies for Chromium and basic tools
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser, claude-code and gemini-cli globally
RUN npm install -g agent-browser @anthropic-ai/claude-code @google/gemini-cli

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script
# Gemini CLI needs HOME set to /root where the session is mounted
RUN printf '#!/bin/bash\nset -e\ncd /app && /app/node_modules/.bin/tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nHOME=/root node /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
# NOTE: Since we mount .gemini to /root/.gemini, we might need to run as root 
# or ensure permissions allow 'node' user to read /root/.gemini.
# However, the user's docker-compose has 'user: root' for nanoclaw-bot.
# For the agent, let's keep it as root if needed for /root/.gemini access.
# If we want to stay as 'node', we should mount to /home/node/.gemini.
# The plan said mount to /root/.gemini 'ro'. 
# Let's use root for now to ensure access to the mounted volume.

USER root

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
