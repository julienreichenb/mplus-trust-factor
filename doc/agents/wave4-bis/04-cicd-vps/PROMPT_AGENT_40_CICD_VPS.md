# Agent 40 Prompt — CI/CD and VPS Deployment Foundation

You are responsible for building a production-grade CI/CD foundation for M+ Trust Factor.

Work on:

- branch: `agent/wave4.3-cicd-vps`
- base: `integration/wave4.3`

No VPS has been purchased. Build a provider-neutral foundation for a later Linux VPS.

## Objectives

Implement reliable monorepo CI, reproducible production images, migration-safe deployment, environment/secret contracts, health checks, rollback, PostgreSQL backup/restore runbooks and a generic VPS topology.

Do not modify scoring or provider behavior.

## Phase 1 — Audit

Inspect workspace structure, package manager, Node version, Dockerfiles, Compose, GitHub Actions, build commands, Prisma generation/migrations, service startup, Redis/PostgreSQL requirements, health endpoints, logging, environment files, secrets, static frontend serving and reverse-proxy assumptions.

Identify missing production requirements.

## Phase 2 — CI pipeline

Implement pull-request CI with:

- frozen dependency install;
- Prisma generation;
- formatting/linting where configured;
- type checking;
- builds;
- tests;
- migration/schema validation;
- Docker image builds;
- dependency/security scanning;
- artifact/log retention.

CI must fail on TypeScript errors, missing Prisma generation, broken migrations, failing tests and invalid Docker builds.

## Phase 3 — Production images

Create or harden images with multi-stage builds, immutable lockfile, minimal runtime, non-root user, explicit Node version, health checks, graceful shutdown, correct signals, no baked secrets, commit-SHA tags and SBOM metadata where practical.

Audit whether web, API and worker need separate images.

## Phase 4 — Production topology

Prepare a generic Linux VPS topology with reverse proxy/TLS, web, API, worker, PostgreSQL, Redis, persistent volumes, private network, health checks, restart policies and log rotation.

Do not hardcode a vendor or IP.

Prefer a production compose file unless another target is already established.

## Phase 5 — Environment and secrets

Provide `.env.production.example`, required/optional variable docs, secret-generation commands, build/runtime separation, Battle.net placeholders, WCL credentials, database/Redis URLs, bootstrap/admin settings, public URLs and callbacks.

Document rotation. Never commit real secrets.

## Phase 6 — Migration-safe deployment

Deployment order:

1. database migration;
2. Prisma generation during build;
3. worker deployment;
4. API deployment.

Create a process that acquires a migration lock, backs up before risky migrations, runs `prisma migrate deploy`, aborts on failure, deploys immutable images, waits for health, rolls back application images on failure and never runs `prisma migrate reset`.

Document database rollback limits.

## Phase 7 — GitHub Actions CD

Prepare registry build/push, staging deployment, production deployment with approval, SSH- or runner-based VPS deployment, immutable release manifest, deployment concurrency lock, health verification, rollback command and release summary.

The VPS must not be required for CI to pass.

## Phase 8 — Backup and restore

Provide scripts/runbooks for scheduled PostgreSQL backups, compressed/encrypted off-host retention where configured, retention, restore to a fresh database, restore verification, Redis as disposable, persistent artifacts and disaster recovery.

Include a local restore test without production credentials.

## Phase 9 — Observability and operations

Prepare structured logs, liveness/readiness, worker/queue health, database/Redis connectivity, disk checks, metrics hooks, alerting recommendations and log redaction.

Do not introduce a large platform without justification.

## Phase 10 — Security baseline

Document firewall ports, SSH hardening, non-root deploy user, Docker socket risks, security updates, TLS renewal, private database/Redis, reverse-proxy headers, rate limiting, image scanning and secret permissions.

## Required tests

1. Clean-checkout CI passes.
2. Prisma generation occurs before TypeScript build.
3. Invalid migration fails CI.
4. Every production image starts healthy.
5. API/worker terminate gracefully.
6. Images contain no `.env` or known secrets.
7. Deployment uses immutable tags.
8. Failed health triggers application rollback.
9. Redis restart does not lose scores.
10. Database backup restores locally.
11. Production topology exposes only required public ports.
12. Full build and tests pass.

## Deliverables

Return infrastructure audit, CI workflow, Dockerfiles, topology, env reference, deployment workflow, migration strategy, backup/restore validation, rollback runbook, security checklist, sizing assumptions, tests, files changed and commit hash.

Do not deploy to a real VPS.
Do not commit secrets.
Do not change application scoring behavior.
