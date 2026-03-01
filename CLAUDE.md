# NanoClaw (Powerhouse Fork)

**Status**: This is a local fork of an external tool. We are NOT the maintainers.
**Migration Note**: If migrating to a new assistant, ensure the "Powerhouse Extensions" listed below are ported.

## Powerhouse Extensions (Custom Features)

1.  **Decoupled Skill Architecture**: Located in `src/config.ts` and `src/container-runner.ts`.
2.  **Mounted Tooling System**: `pw-sync.js` is mounted from host into agent containers.
3.  **`n8n-tool` Skill**: Located in `container/skills/n8n-tool/SKILL.md`.

## Development Mandates (Powerhouse Standards)

- **Surgical Edits**: NEVER overwrite foundational files (like root `README.md`) when adding feature documentation. Always use targeted injections or create specific guides in subdirectories (e.g., `container/skills/README.md`).
- **External Tool Awareness**: Maintain a clear boundary between upstream code and Powerhouse extensions to facilitate future migrations.
- **Zero Ingress Maintenance**: Use host-side `sqlite3` for n8n API key management. See `docs/adr/0001-decoupled-skill-architecture.md`.

## Architecture & Integration

| Component | Role |
|-----------|------|
| `skill-service` | Standalone registry in `orchestrator/infra`. |
| `pw-sync` | CLI bridge for agents to push/pull n8n JSON. |
| `infra_core-net` | Isolated network for all inter-service traffic. |

## Development

```bash
npm run dev          # Run core bot
./container/build.sh # Rebuild agent container
```
