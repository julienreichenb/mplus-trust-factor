# ADR 0003 — Prisma + PostgreSQL

## Status

Accepted

## Context

The domain requires rich relational constraints, idempotent ingestion uniques, and migrations that all agents can reason about.

## Decision

Use PostgreSQL with Prisma ORM and migrations. Pin Prisma 6.x for straightforward Postgres driver wiring on a small VPS (defer Prisma 7 adapter complexity unless needed).

## Consequences

- Single source of schema truth in `packages/database`.
- Typed client shared by API and worker.
- Large binary/event payloads should use RawArtifact storage, not unbounded JSONB.
