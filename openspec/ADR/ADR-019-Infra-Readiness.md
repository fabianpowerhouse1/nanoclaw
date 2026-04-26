# ADR-019: Infrastructure & Production Readiness

## Status
Accepted (Restored V7.7.7)

## Context
As the project transitions from prototype to production-grade deployment, we must define the minimum infrastructure requirements and the topology for a stable, observable environment.

## Decision
We adopt the following production readiness standards:
1. **Deployment Topology**: Containerized microservices orchestrated via Docker Compose (or K8s in later phases).
2. **Secret Isolation**: Zero-ENV strategy. Secrets must be injected via secure volume mounts or a vault, never hardcoded in images.
3. **Observability**: Mandatory Prometheus/Grafana integration for all container telemetry.
4. **Zero-Downtime**: Adoption of the Expand/Contract pattern for all database migrations.

## Consequences
- Increased configuration overhead for local development (requiring vault/volume mocks).
- Mandatory audit gates for all infrastructure PRs.
