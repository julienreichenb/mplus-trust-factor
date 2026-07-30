# Warcraft Logs data pipeline

## Production tip (current)

| Concern | Location / note |
|---------|-----------------|
| Shared evidence ingest | `packages/providers/warcraftlogs/src/evidence/` |
| Survival | Production analysis path + Survival v1.1.1 probe config |
| Utility | Observed contribution v3.2 → worker refresh / shadow publication path |
| Orchestration | `apps/worker/src/orchestration/refresh-pipeline.ts` |

## Cost and sample discipline

- Prefer one canonical best run per active-season dungeon (≈ **8** detailed scoring runs).
- Reuse shared evidence for Performance / Survival / Utility before extra WCL calls.
- Programme Utility fallback (Agents 06–07): only `INSUFFICIENT_EVIDENCE_RETRYABLE`; caps and budget accounting are upcoming — do not invent live caps in docs before code lands.
- Never spend live WCL budget in agent work unless the prompt explicitly allows it.

## Research probes

Utility and Survival historical probes under `packages/providers/warcraftlogs/src/probe/` remain **KEEP_RESEARCH / TEMPORARY_ACTIVE** while `package.json` `wcl:probe:*` scripts and calibration need them.

**Do not delete** those probes in docs-canonicalization or opportunistic cleanup (Agent 12 owns deferred retirement with a deletion manifest).

## Classification source

[`docs/audits/repository-inventory-2026-07/probe-matrix.csv`](../../docs/audits/repository-inventory-2026-07/probe-matrix.csv)
