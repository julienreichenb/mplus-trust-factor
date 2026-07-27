# Agent 6 — Realm autocomplete

## Problem

Home search needs debounced realm autocomplete. No shared contract or route exists.

## Proposal (Agent 5)

- `GET /api/v1/realms?region=EU&q=tar` → `{ realms: Array<{ slug: string; name: string }> }`
- Limit results (e.g. 20); EU seed realms sufficient for MVP.

## Status

Applied by Agent 10 — `GET /api/v1/realms` accepts `query` or `q`.
