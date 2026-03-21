# V0.4 Skill Architecture Summary

- **Three-Level Resolution Model:** Prioritizes deterministic Git merges (`merge-file`, `rerere`), falls back to AI-driven conflict resolution using structured intent files (`.intent.md`), and only involves the user for genuine semantic ambiguity.
- **Hybrid Change Management:** Distinguishes between **Code Files** (handled via three-way merges against a clean `.nanoclaw/base/`) and **Structured Data** (e.g., `package.json`, `.env`) which are aggregated programmatically through batched "Structured Operations."
- **Safety and Reliability:** Enforces a mandatory **Backup/Restore** flow for all operations and requires successful **Automated Test execution** after every merge, ensuring that even "clean" text merges are semantically correct before finalization.
