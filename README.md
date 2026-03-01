<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  My personal Claude assistant that runs securely in containers. Lightweight and built to be understood and customized for your own needs.
</p>

<p align="center">
  <a href="https://nanoclaw.dev">nanoclaw.dev</a>&nbsp; • &nbsp;
  <a href="README_zh.md">中文</a>&nbsp; • &nbsp;
  <a href="https://discord.gg/VDdww8qS42"><img src="https://img.shields.io/discord/1470188214710046894?label=Discord&logo=discord&v=2" alt="Discord" valign="middle"></a>&nbsp; • &nbsp;
  <a href="repo-tokens"><img src="repo-tokens/badge.svg" alt="34.9k tokens, 17% of context window" valign="middle"></a>
</p>

**New:** First AI assistant to support [Agent Swarms](https://code.claude.com/docs/en/agent-teams). Spin up teams of agents that collaborate in your chat.

## Decoupled Skill Architecture

NanoClaw now supports **Language-Agnostic Tools** managed by a separate `skill-service`. This service acts as a centralized tool registry, allowing agents to interact with infrastructure (like n8n) via a secured internal REST API.

- **Internal Security**: Communication is secured via a Pre-Shared Key (PSK) over an isolated Docker network.
- **`n8n-tool`**: The first decoupled skill, allowing agents to import/export workflows as declarative JSON using the `pw-sync` CLI.

## Quick Start

```bash
git clone https://github.com/qwibitai/nanoclaw.git
cd nanoclaw
claude
```

Then run `/setup`. Claude Code handles everything: dependencies, authentication, container setup, service configuration.

## Decoupled Skill Architecture

This installation supports **Language-Agnostic Tools** managed by a separate `skill-service`. This ensures that skills remain infrastructure assets, independent of the core bot process. For a detailed guide on our skill strategy and implementation, see [container/skills/README.md](container/skills/README.md).

## Architecture

```
WhatsApp/Telegram --> SQLite --> Polling loop --> Container (Agent) --> Skill Service --> n8n
```

Agents execute in isolated Linux containers. When a decoupled skill is used, the agent container communicates with the `skill-service` on the internal `core-net`, which in turn interacts with protected infrastructure.

... [rest of file]
