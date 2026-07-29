# Wave 4.3 Acceptance Matrix

| Capability | Required result |
|---|---|
| Experience | Evidence-based, source-documented, versioned and locally reproducible |
| Character-only public score | No unauthenticated alt inference |
| Battle.net OAuth | Secure flow based on official Blizzard documentation |
| Character ownership | Verified account-to-character links stored privately |
| IAM | Roles and permissions enforced server-side |
| Admin refresh | Permission-based cooldown bypass with audit logging |
| Premium readiness | Entitlement model prepared, no billing integration |
| Automatic refresh | Budget-aware, idempotent, resumable and configurable |
| Cohort selection | Explicit denominator and source; no vague global top 25% |
| WCL usage | Shared evidence reuse, cost measurement and hard budget limits |
| CI | Install, generate, lint, build and test on pull requests |
| CD | Immutable images, migration gate, health checks and rollback |
| PostgreSQL | Durable source of truth |
| Redis | Optional for correctness |
| Public GET | Zero synchronous external provider calls |
| Failed refresh | Last published score remains visible |
| Secrets | Never committed or emitted in logs |
