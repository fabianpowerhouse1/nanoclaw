# Tech Debt Ledger

## 2026-04-23: Go Runtime Addition (Track A)
- **Change:** Added `golang` to `powerhouse/project-nanoclaw/container/Dockerfile`.
- **Reason:** Support testing and implementation for Gemini CLI in agent containers.
- **Debt:** 
    - Container image size increased. 
    - Using default Debian `golang` package which might not be the latest stable version.
- **Mitigation:** Consider a multi-stage build or specific Go binary download if a specific version or smaller image is required in the future.
