/**
 * Evidence Contract V2 — shared interface between Workstreams 02 and 03.
 *
 * Normative selection behaviour:
 * `doc/scoring/v2/03_WCL_EVIDENCE_SELECTION_CONTRACT.md`.
 *
 * status: accepted-for-checkpoint
 * last_reviewed: 2026-08-02
 */

# WS02 / WS03 shared evidence interface

## Ownership

| Concern | Owner | Must not |
|---|---|---|
| Discovery + hydration | WS03 | Select final slots / invent acquisition policy |
| Factual candidate metadata | WS03 | Encode ordering or fallback policy |
| Incompleteness / access diagnostics | WS03 | Drive ordering beyond eligibility |
| Provider acquisition execution + cost probes | WS03 | Create `EvidenceAcquisitionPlanV2` |
| `EvidenceAcquisitionPlanV2` contracts + pure plan build | WS02 | Call providers / Prisma / queues |
| Deterministic candidate ordering + fallbacks | WS02 | Read parse / deaths / utility / labels |
| `EvidenceManifestV2` pure finalization | WS02 | Freeze before acquisition |
| Coverage + rejection reasons | WS02 | |

## Identity stages

```text
discovery identity = reportCode + fightId          (plan stage)
frozen identity    = reportCode + fightId + reportRevision  (manifest stage)
```

Do not freeze `EvidenceManifestV2` before acquisition. Two selected slots may not
share the same discovery identity. A slot freezes only when `reportRevision` is
known after acquisition/validation.

## Lifecycle

```text
1. WS03 → EvidenceCandidateMetadataV2[]
2. WS02 buildEvidenceAcquisitionPlanV2 → EvidenceAcquisitionPlanV2 (frozen)
     - ordered candidates + fallbacks per desired slot
     - discovery identity only
     - technical rejection reasons
3. WS03 executes provider-aware acquisition from that plan
4. WS02 finalizeEvidenceManifestV2 → CharacterSeasonEvidenceManifestV2 (frozen)
     - frozen identity with reportRevision
     - selected / rejected / fallback reasons / missing slots
     - dataset + fact-set hashes
     - final coverage
```

WS03 must not own or create acquisition policy; it only executes the WS02 plan.

## Public API (WS02)

- `buildEvidenceAcquisitionPlanV2(input) → { plan }`
- `finalizeEvidenceManifestV2({ plan, acquisitionResults, selectedAt }) → { manifest }`

Removed: `selectEvidenceManifestV2` (incorrectly froze the manifest before acquisition).

## Package map

- Contracts: `packages/contracts/src/evidence-v2.ts`
- Selector: `packages/scoring/src/selection/evidence-v2-selector.ts`
- Adapters (V1 run DTOs → metadata): `packages/scoring/src/selection/evidence-v2-adapters.ts`

## Checkpoint constraints

This checkpoint does not modify Prisma, queues, scoring formulas, publication,
feature flags, or calibration runtime.
