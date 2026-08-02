# Handoff — Prompt 11 Admin diagnostics and public explainability

**Branch:** `feat/scoring-v2-explainability`  
**Checkpoint:** stop — no flag enable / no deploy  
**Date:** 2026-08-02

## Delivered

- Additive contracts: `packages/contracts/src/explainability-v2.ts` (public + admin DTOs, sanitization).
- Builders: `packages/scoring/src/explainability-v2/` (`buildExplainabilityV2Admin`, `toPublicExplainabilityV2`).
- Admin GET APIs (RBAC `score.candidate.read`, DB-only):
  - `GET /api/v1/admin/scoring-v2/manifests` (paginated)
  - `GET /api/v1/admin/scoring-v2/characters/:characterId/explainability`
- Public profile additive field `explainabilityV2` (null while lifecycle is SHADOW).
- Admin UI `/admin/scoring-v2` — matrix, rejected candidates, datasets, fact-sets, dimensions, V1/V2 comparison, batch/queue, calibration links.
- Public UI `ExplainabilityV2Panel` — coverage, confidence, grade U semantics, Utility observed-contribution, key levels without report codes.

## Security

- Public never includes report codes / tokens / linked identities / raw events.
- Admin may show report codes; still omits raw fact payloads (fact keys only) and redacts token-like provider details.
- GET paths do not call providers.

## Validation run

```text
pnpm test:raw -- packages/contracts/src/explainability-v2.test.ts packages/scoring/src/explainability-v2/build.test.ts apps/api/src/services/explainability-v2-service.test.ts
→ pass

pnpm --filter @mplus/web test -- src/lib/adminNav.test.ts src/components/profile/ExplainabilityV2Panel.test.ts src/components/layout/AppHeader.test.ts
→ pass

pnpm --filter @mplus/web typecheck
→ pass

pnpm --filter @mplus/contracts build && pnpm --filter @mplus/scoring typecheck
→ pass
```

Route inject suite `apps/api/src/routes.admin-explainability-v2.test.ts` requires isolated DB (`pnpm test`).

## Explicit non-goals / follow-ups

- Flags remain default-off; `SCORING_V2_PUBLICATION_ENABLED` not enabled.
- Public `explainabilityV2` stays null until non-SHADOW publication lifecycle.
- No live WCL spend; no deploy; no merge.

## Deviations

None vs Prompt 11 intent. Calibration deep UI redesign deferred (links only).
