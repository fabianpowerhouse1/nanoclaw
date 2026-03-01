# Powerhouse Skill Architecture

This document details the strategy, structure, and implementation of skills within the Powerhouse NanoClaw ecosystem. Our goal is **Cognitive Decoupling**: ensuring that the assistant's capabilities are not hardcoded into its core brain, but are instead managed as independent, language-agnostic infrastructure assets.

## Strategy: The Decoupling Pivot

Traditional AI tools are often tightly coupled to the agent's source code. In Powerhouse, we employ two distinct layers of skill management to ensure portability and security:

1.  **Local Context Skills**: Tools that live within the agent's container environment (e.g., Browser, Filesystem).
2.  **Decoupled Infrastructure Skills**: Tools that live *outside* the agent's container and are accessed via an internal Service Registry (e.g., n8n Brain Sync).

### Why Decouple?
- **Resilience**: If the core NanoClaw process is deleted or migrated, the skills (Infrastructure Assets) remain intact.
- **Security**: Highly privileged operations (like interacting with the n8n API) are handled by a dedicated `skill-service`, minimizing the attack surface of the agent container.
- **Agnosticism**: Skills can be written in any language (Node, Python, Go) and consumed by any future assistant.

---

## Skill Structures

### 1. Local Skills (Container-Native)
These skills provide the agent with immediate environmental capabilities.
- **Location**: `container/skills/`
- **Mechanism**: Bind-mounted into the agent's `/home/node/.claude/skills/`.
- **Definition**: A `SKILL.md` file that uses the [Claude Agent SDK](https://code.claude.com/docs/en/skills) format to teach the AI how to use local binaries.
- **Example**: `agent-browser` (Chromium automation).

### 2. Decoupled Skills (Infrastructure-Service)
These skills provide the agent with access to the broader Powerhouse infrastructure.
- **Location**: `orchestrator/infra/skill-service/`
- **Mechanism**: An internal REST API reachable over the `infra_core-net` Docker network.
- **Definition**: Registered tools in the `skill-service` discovery endpoint.
- **Example**: `n8n-tool` (Workflow synchronization).

---

## Implementation Details

### The Tooling Bridge (`pw-sync`)
To simplify the interface for agents, we provide a unified CLI bridge called `pw-sync`. This tool is automatically mounted into every agent container at `/usr/local/bin/pw-sync`.

**Usage Pattern:**
```bash
# Agents call the bridge, which handles PSK auth and network routing
pw-sync n8n export <workflow-id>
```

### Internal Security (Zero Ingress)
All inter-service communication is secured via a **Pre-Shared Key (PSK)** pattern:
1.  The `orchestrator` generates a 32-byte secret (`sk_psk`).
2.  The `skill-service` loads this secret to validate incoming requests.
3.  The NanoClaw `container-runner` injects this secret into agent environments as `SKILL_SERVICE_PSK`.
4.  Traffic is restricted to the internal bridge network; no ports are exposed to the host or the internet.

---

## Development Guide: Adding a New Skill

To add a new infrastructure capability:

1.  **Backend**: Add a new tool handler to the `skill-service` in the `orchestrator` repository.
2.  **CLI**: Update `pw-sync.js` to expose the new tool to the agents.
3.  **Instruction**: Create a new folder in `container/skills/` with a `SKILL.md` that teaches the agent the new `pw-sync` command.
4.  **Deploy**: Run `./rebuild.sh` in the orchestrator to apply changes.

---

## Migration Registry
If migrating from NanoClaw to another assistant platform, the following "Powerhouse Extensions" must be ported to maintain parity:
- [ ] `src/container-runner.ts` -> Logic for mounting `pw-sync` and injecting PSK.
- [ ] `src/config.ts` -> Skill Service environment resolution.
- [ ] `container/skills/` -> The declarative instruction set for the AI.
