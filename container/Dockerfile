# NanoClaw Agent Container
# Optimized V8.4.1 Zero-Trust Agent (Harness-Mandatory)

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
    golang \
    && rm -rf /var/lib/apt/lists/*

# Verify Go installation
RUN go version

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser, claude-code and gemini-cli globally
RUN npm install -g agent-browser @anthropic-ai/claude-code @google/gemini-cli @fission-ai/openspec@latest

# Create app directory
WORKDIR /app

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Set environment for global npm binaries
ENV NPM_CONFIG_PREFIX=/root/.npm-global
ENV PATH=$PATH:/root/.npm-global/bin

WORKDIR /workspace

# Mandatory V8.4 Entrypoint (mounted from host or provided as placeholder)
# Host orchestrator/bin/factory sync will mount scripts/agent-init.sh to /usr/local/bin/agent-init.sh
ENTRYPOINT ["/usr/local/bin/agent-init.sh"]
