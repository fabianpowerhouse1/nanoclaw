# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp/Telegram, routes messages to agents running in containers. Supports **Decoupled Skills** via a standalone `skill-service`.

## Key Files & Infrastructure

| File/Service | Purpose |
|--------------|---------|
| `skill-service` | Standalone tool registry (managed in `orchestrator/infra`). |
| `src/config.ts` | Handles `SKILL_SERVICE_URL` and `SKILL_SERVICE_PSK`. |
| `src/container-runner.ts`| Mounts `pw-sync.js` into containers. |
| `container/skills/n8n-tool/` | Skill definition for n8n sync logic. |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated). |

## Decoupled Skill Layer (The "Tool-as-a-Service" Pattern)

Agents interact with the `skill-service` using the `pw-sync` CLI tool.
- **n8n Sync**: `pw-sync n8n export/import` manages workflows as JSON.
- **Security**: Authenticated via internal PSK over `infra_core-net`.

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

## Zero Ingress Management

The n8n UI is not exposed. To bootstrap or reset API keys, use host-side `sqlite3` to inject encrypted keys into the `user_api_keys` table. See `docs/adr/0001-decoupled-skill-architecture.md` for the exact procedure.
