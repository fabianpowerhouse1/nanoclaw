# V0.4 Skill Architecture Summary

*   **Three-Level Resolution Model**: Prioritizes deterministic git merges (`merge-file`, `rerere`), escalates to Claude for intent-based conflict resolution, and only involves the user for genuine product ambiguities.
*   **Shared Base & Three-Way Merges**: Maintains a clean core in `.nanoclaw/base/` as a common ancestor, enabling robust drift detection and reliable merging of both code logic and structured data (npm deps, env vars).
*   **Safe Operations & State Tracking**: Implements a mandatory backup/restore flow for all modifications and records the complete system state (applied skills, file hashes, and resolutions) in `state.yaml` for deterministic replays.