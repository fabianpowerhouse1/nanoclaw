# ADR 0001: Decoupled Skill Architecture & Zero Ingress Brain Sync

## Status
Accepted

## Context
NanoClaw agents needed a way to autonomously manage n8n workflows. However, building these capabilities directly into the core bot created a "monolithic anti-pattern." We needed a solution that was language-agnostic and resilient to core bot deletions.

## Decision
We implemented a "Tool-as-a-Service" layer called the `skill-service`. 

1.  **Isolation**: The service runs in a standalone container on the internal `core-net` network.
2.  **Protocol**: Communication uses a REST API with a `/tools` discovery endpoint.
3.  **Security**: Authentication between agents and the skill-service uses a Pre-Shared Key (PSK) injected via Docker Secrets.
4.  **Tooling**: A CLI tool (`pw-sync`) is mounted into all agent containers to act as the bridge.

## Consequences
*   **Decoupling**: Skills are now infrastructure assets, managed by the `orchestrator`.
*   **Security**: No external ingress is required for n8n automation.
*   **Complexity**: Bootstrapping n8n requires manual database injection or user activation since the UI is unreachable.

## Learnings (The "Final Key Paradox")
n8n (v2.x/v1.x) encrypts API keys using AES-256-GCM. In a Zero Ingress environment, API keys must be injected into the `user_api_keys` table using host-side encryption scripts that match n8n's internal cipher logic.
