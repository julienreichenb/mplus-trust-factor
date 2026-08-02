# WCL Evidence Query Planner V2 (Workstream 03)

## Shared interface with Workstream 02

| Stage | Identity fields |
|-------|-----------------|
| Candidate discovery | `reportCode` + `fightId` |
| Final frozen | `reportCode` + `fightId` + `reportRevision` |

**WS03 owns:** discovery/hydration grouping, factual candidate metadata, incompleteness/access diagnostics, dataset/cost plans, provider probes.

**WS03 must not** select final slots or finalize `EvidenceManifestV2`.

**WS02 owns:** `EvidenceAcquisitionPlanV2` (ordered discovery-identity candidates), deterministic ordering, fallback rules, `EvidenceManifestV2`, coverage, rejection reasons.

**WS02 must not** call providers, Prisma, or queues.

Canonical types/helpers are imported from `@mplus/contracts` (`evidence-v2`). WS03-local dataset/cost plan shapes live in `planner-types.ts` and are **not** `EvidenceAcquisitionPlanV2`.

## API

- `planCandidateDiscovery` — bounded merge of zone rankings / parse rows / recent reports / persisted sources; hydration groups by report code; no slot selection
- `planDetailedEvidence` — dataset union + `WclDatasetCostPlanV2` from **frozen** WS02 slots
- `buildPlannerCompatibilityKey` — includes hostility + `includeResources`
- Cost kinds: `KNOWN` | `UNKNOWN` | `ZERO_CACHE_HIT` (unknown ≠ zero)

## Tests / probes

```bash
pnpm exec vitest run --config vitest.config.ts packages/providers/warcraftlogs/src/planner
ALLOW_LIVE_PROVIDER_CALLS=true pnpm wcl:probe:planner
```

Probes never run in CI. Live identities must not be committed; use `tmp/` + sanitizers.

See `EVIDENCE_COST_AUDIT_REPORT_TEMPLATE.md` for the audit write-up template.
