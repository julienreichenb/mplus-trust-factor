# Worker DAG

Queues (Agent 0 contracts):

| Queue | Processor |
|-------|-----------|
| `refresh-character` | Full refresh pipeline |
| `analyze-run` | WCL fight analysis |
| `recalculate-score` | Re-score from stored observations |
| `generate-addon-export` | Addon export metadata + prune artifacts |

## Refresh pipeline stages

```text
resolve-character
  → refresh-blizzard
  → refresh-raiderio
  → refresh-warcraftlogs-summary
  → match-detailed-runs
  → analyze-run (inline in fixture pipeline; also available as queue job)
  → extract-metrics
  → calculate-score
  → refresh-character-finalize
```

Stage names are logged for observability. Provider-disabled stages soft-skip (`ProviderDisabledError` / `CIRCUIT_OPEN`) and continue; confidence and red flags reflect gaps.

## Idempotency

- BullMQ `jobId` = dedupe key from `apps/worker/src/dedupe.ts`
- `IngestionJob.dedupeKey` unique; non-terminal jobs are reused
- DB unique constraints on character identity, run fingerprint, score fingerprint

## Retry classification

| Error | Behavior |
|-------|----------|
| `TIMEOUT`, `NETWORK` | Retry / backoff |
| `RATE_LIMITED`, `BUDGET_EXCEEDED` | Delayed retry |
| `NOT_FOUND` | Negative cache; no rapid retry |
| `INVALID_RESPONSE` | Fail / manual review |
| Provider disabled | Soft-skip stage |

## Fixture providers

Live provider packages (Agents 1–3) remain stubs. Worker owns fixture adapters implementing `@mplus/contracts` interfaces under `apps/worker/src/providers/`. API/tests inject via `createWorkerContainer` / `createApiContainer` DI.

## Graceful shutdown

Worker closes BullMQ workers, queue handles, and Redis on `SIGINT`/`SIGTERM`. API closes producers/Redis via Fastify `onClose`.
