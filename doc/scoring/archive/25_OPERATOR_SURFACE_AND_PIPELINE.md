# Scoring V2 — operator surface and pipeline lifecycle

**Status:** normative for operator entry points.  
**Publication:** independent gate; shadow pipeline never mutates the public pointer by default.

## Supported commands

| Command | Purpose | Provider calls |
|---------|---------|----------------|
| `pnpm scoring-v2:canary -- --region … --realm … --character … --confirm-execute` | Full self-healing shadow pipeline for one character | Yes (when armed) |
| `pnpm scoring-v2:replay -- --region … --realm … --character …` | Reconstruct scores from persisted evidence | **Zero** |
| `pnpm scoring-v2:doctor -- --region … --realm … --character …` | Provider-free diagnostics (season, manifest, digests) | **Zero**; no mutation |

Contextual recovery commands (`discover`, `repair-package`, `ranking-hydrate`, `reconcile-revisions`, `rate-snapshot`, …) are **internalized**. Their logic remains as pipeline stages and focused tests; they are not part of the public operator surface.

## Normal pipeline lifecycle

```
season authority
  → discover / reuse frozen manifest
  → reconcile report revisions (when live)
  → package integrity scan + automatic supersession
  → ranking hydrate (missing facts only)
  → capability acquire for genuine misses
  → participant digests (stable character identity)
  → Performance / Utility / Survival + confidence
  → provider-free replay verification
  → publication eligibility (diagnostic only unless separately authorized)
```

Production character refresh calls the same self-healing package integrity path via `maybeStartScoringV2ShadowFromRefresh` under Scoring V2 shadow feature flags. V1 remains authoritative until publication approval.

## Automatic repairs

| Condition | Automatic action |
|-----------|------------------|
| No compatible frozen manifest | Discovery stage (when canary execute armed) |
| Report revision drift | Manifest supersede + ranking lineage carry-forward |
| Package actor set excludes target / mismatches fight roster | Superseding package acquire (prior row retained) |
| Missing READY ranking facts | Ranking metadata hydrate (no capability event pages) |
| Digest ranking content changed | Digest refresh on contentHash mismatch |

Repairs never require hard-coded character names, report codes, or fight IDs.

## Idempotency

A second complete run with compatible evidence:

- reuses the frozen manifest;
- performs zero capability acquisitions when packages are compatible;
- reuses READY ranking facts;
- creates no duplicate current digests;
- reproduces scores/confidence;
- `scoring-v2:replay` performs zero provider calls.

## Publication policy

- `SCORING_V2_PUBLICATION_ENABLED` must stay false for shadow runs.
- Public score pointer mutation is an independent approval path.
- Partial evidence lowers confidence or marks PARTIAL; it never fabricates parses.

## Troubleshooting states

| Symptom | Doctor / report stage | Next |
|---------|----------------------|------|
| Season catalog mismatch | `season` | Fix ActiveMythicPlusSeasonAuthority / bindings |
| Manifest missing | `discovery_manifest` | Arm canary execute and re-run canary |
| Target digest count &lt; selected slots | `package_integrity` / `target_digest_diagnostic` | Inspect automatic supersession items |
| Performance PARTIAL | `ranking_evidence` | Ranking still missing for some slots |
| Replay providerCalls ≠ 0 | `replay` | Fail closed — investigate ports |

## Migration / deployment

1. Apply Prisma migrations (including package `supersedes_compatibility_key`).
2. Deploy worker with shadow flags on, publication off.
3. Validate with `scoring-v2:doctor` then armed `scoring-v2:canary` on one character.
4. Confirm warm `scoring-v2:replay` is zero-provider.

## Archived development record

Incident-oriented Wallidrixe recovery notes: [`SHADOW_CANARY_STATUS.md`](SHADOW_CANARY_STATUS.md) (historical).
