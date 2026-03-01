# NanoClaw (Powerhouse Fork)

**Status**: This is a local fork of an external tool. We are NOT the maintainers.
**Migration Note**: If migrating to a new assistant, ensure the "Powerhouse Extensions" listed below are ported.

## Powerhouse Extensions (Custom Features)

These features are unique to this installation and are not part of the upstream NanoClaw repository:

1.  **Decoupled Skill Architecture**: 
    *   **Logic**: Located in `src/config.ts` and `src/container-runner.ts`.
    *   **Purpose**: Allows agents to call infrastructure-managed tools via an internal `skill-service`.
2.  **Environment Integration**:
    *   `SKILL_SERVICE_URL` & `SKILL_SERVICE_PSK`: Handled in `config.ts` to secure agent-to-service communication.
3.  **Mounted Tooling System**:
    *   The `pw-sync.js` tool is mounted from the `orchestrator` host directly into agent containers at `/usr/local/bin/pw-sync`.
4.  **`n8n-tool` Skill**:
    *   Located in `container/skills/n8n-tool/SKILL.md`. Provides the declarative interface for n8n workflow synchronization.

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

## Maintenance (Zero Ingress)

The n8n UI is hidden. To manage API keys, you must use host-side database injection. 
**Procedure**: Stop n8n container -> Encrypt key via `n8n-encryptor.js` -> Inject into `user_api_keys` table using `sudo sqlite3`.
See `docs/adr/0001-decoupled-skill-architecture.md` for full details.
