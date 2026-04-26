# ADR-016: Async Job Lifecycle & State Machine

## Status
Accepted (Restored V7.7.7)

## Context
The system requires a robust, asynchronous job processing engine to handle long-running container deployments and telemetry collection. We need a deterministic state machine to manage retries, failures, and success states.

## Decision
We will implement a 5-state lifecycle for all jobs:
1. `PENDING`: Initial state upon creation.
2. `ACTIVE`: Job is currently being processed by a worker.
3. `COMPLETED`: Job finished successfully.
4. `FAILED`: Job encountered a terminal error.
5. `RETRY`: Job failed but is eligible for a re-attempt.

## Consequences
- Requires a persistent `jobs` table in the database.
- Workers must update the state atomically to prevent race conditions.
- Observability hooks must trigger on `FAILED` and `COMPLETED` transitions.
