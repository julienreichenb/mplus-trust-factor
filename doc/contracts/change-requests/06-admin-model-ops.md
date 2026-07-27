# Agent 6 — Admin model operations

## Problem

`AdminScoreModelDTO` exists, but contracts lack request/response types for:

- list models
- clone active → draft
- update draft config
- validate config
- fixture backtest
- activate version

## Proposal (Agent 5)

Document OpenAPI routes (suggested):

- `GET /api/v1/admin/models` → `AdminScoreModelDTO[]`
- `POST /api/v1/admin/models/:id/clone` → draft `AdminScoreModelDTO`
- `PUT /api/v1/admin/models/:id` body `{ config }` → `AdminScoreModelDTO`
- `POST /api/v1/admin/models/:id/validate` → `{ valid: boolean; errors: string[]; weightSum: number }`
- `POST /api/v1/admin/models/:id/backtest` → `{ summary: unknown }`
- `POST /api/v1/admin/models/:id/activate` → activated model

Auth: `ADMIN_API_KEY` header (MVP).

## Status

Applied by Agent 10 — `POST /api/v1/admin/score-models/:id/clone`, `PUT /api/v1/admin/score-models/:id`.
