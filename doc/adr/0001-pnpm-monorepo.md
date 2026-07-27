# ADR 0001 — pnpm workspaces monorepo

## Status

Accepted

## Context

Multiple apps (API, worker, web) and shared packages (contracts, database, providers, scoring) must evolve in parallel with clear ownership.

## Decision

Use a single pnpm workspaces monorepo with `apps/*`, `packages/*`, `packages/providers/*`, and `tools/*`.

## Consequences

- Shared contracts and types are versioned in-repo.
- Parallel agents can own package paths with fewer merge conflicts.
- One lockfile pins the dependency graph for a small VPS deploy.
