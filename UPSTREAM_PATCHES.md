# Upstream Patches for Powerhouse NanoClaw

This document tracks the technical modifications applied to the base NanoClaw engine to support the Powerhouse Architectural Mandates. These patches ensure security, operational stability, and persona-driven governance.

## 1. Non-Interactive Execution Hardening
- **Modification:** Forced injection of `CI=true` and `NONINTERACTIVE=1` environment variables into dynamic agent containers.
- **Location:** `src/container-runner.ts` (within `buildContainerArgs`).
- **Rationale:** Prevents the "Infinite Hang" caused by CLI tools (e.g., `npm`, `vite`) waiting for user confirmation in a non-interactive shell. Ensures that all tools exit or fail immediately rather than stalling the bot's execution queue.

## 2. System Prompt (Persona) Injection
- **Modification:** Added support for `DEFAULT_SYSTEM_PROMPT_PATH` environment variable and logic to read and prepend an external persona file to the LLM's initial prompt.
- **Location:** `container/agent-runner/src/index.ts` and `src/container-runner.ts`.
- **Rationale:** Decouples the agent's behavior from its hardcoded engine logic. Allows for dynamic persona governance (e.g., Senior PM persona) by mounting read-only instruction files from the host into the agent's context.

## 3. Dynamic Workspace Isolation
- **Modification:** Complete rewrite of `buildVolumeMounts` to enforce strict isolation.
- **Location:** `src/container-runner.ts`.
- **Rationale:** 
    - **Security:** Removed mounts that exposed the `project-nanoclaw` or `orchestrator` source code to the agent, preventing container escape or unauthorized code modification.
    - **Determinism:** Redirected agent workspaces to isolated, absolute host paths (e.g., `/home/ubuntu/powerhouse/workspaces/{group}`) to ensure file persistence and prevent inode drift across Docker-out-of-Docker (DooD) translations.
    - **Context:** Added a read-only mount for `/workspace/active_sessions` to provide agents with secure access to persona instructions.
