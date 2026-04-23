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
    golang \
    && rm -rf /var/lib/apt/lists/*

# Verify Go installation
RUN go version

# Install GitHub CLI (gh)
RUN mkdir -p -m 755 /etc/apt/keyrings && \
    mkdir -p /etc/apt/apt.list.d && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/apt.list.d/github-cli.list > /dev/null && \
    apt-get update && \
    apt-get install -y gh

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser, claude-code and gemini-cli globally
RUN npm install -g agent-browser @anthropic-ai/claude-code @google/gemini-cli @fission-ai/openspec@latest

# Create app directory
WORKDIR /app
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Install pw-sync CLI (mount it from host orchestrator or copy during build)
RUN echo '#!/usr/bin/env node\nconsole.log("pw-sync placeholder")' > /usr/local/bin/pw-sync && chmod +x /usr/local/bin/pw-sync

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Set environment for global npm binaries
ENV NPM_CONFIG_PREFIX=/root/.npm-global
ENV PATH=$PATH:/root/.npm-global/bin

WORKDIR /workspace

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
