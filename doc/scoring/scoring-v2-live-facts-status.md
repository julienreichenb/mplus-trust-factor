# Scoring V2 — live fact extraction status (WS12.5 / CP1–CP4)

Canonical status for Phase 1 typed shadow readiness after disposable-DB proof.

## Delivered (CP1–CP4)

| Checkpoint | Commit | Behavior |
|------------|--------|----------|
| CP1 | `c5936a2` | Pure typed extractors (Performance / Survival / Utility) — fixture-backed, provider-free at call site |
| CP2 | `5b6c02f` | Immutable dataset requirements → fixture/provider transport → artifacts → typed `RunFactSet` persistence; no successful `shadow_placeholder` |
| CP3 | `d7fbf66` | DB-only Experience V3 history loader (MythicRun + CharacterProviderState + persisted RIO payload); wired into shadow finalization |
| CP4 | this commit | Disposable-DB E2E: fixture acquisition → freeze → four SHADOW `DimensionComputation` rows; multi-fact slot binding hash |

## Phase 1 fixture shadow gate — result

**GO for Prompt 13 (context / calibration planning only)** — CP4 disposable-DB E2E is green.

Proven on allowlisted disposable integration DB (`pnpm test:integration`):

- fixture transport acquisition (no live GraphQL / HTTP; `assertNoNetworkReachable`);
- typed Performance / Survival / Utility fact sets (no `shadow_placeholder` on success);
- Experience history from persisted DB evidence only;
- frozen `EvidenceManifestV2` (2 selected slots; reportCode + fightId + reportRevision);
- multi-member slot `factSetHash` binding (`buildSlotFactSetBindingHash`);
- provider-free finalization;
- four SHADOW dimension rows with `AVAILABLE` or `PARTIAL`, non-null scores;
- `publicationBlocked: true`; no `CharacterPublishedScore` mutation.

Example sufficient-evidence scores from CP4 E2E (fixture; not live characters):

| Dimension | Availability | Score | Confidence | Lifecycle |
|-----------|--------------|-------|------------|-----------|
| PERFORMANCE | PARTIAL | 75.8288 | 0.7098 | SHADOW |
| SURVIVAL | PARTIAL | 98.2428 | 0.5607 | SHADOW |
| UTILITY | AVAILABLE | 50.43 | 0.26 | SHADOW |
| EXPERIENCE | PARTIAL | 72.7326 | 0.5181 | SHADOW |

**NO-GO for production activation** — see blockers below.

## Fixture/local Phase 1 readiness vs production readiness

| Surface | Fixture / local disposable DB | Live production providers |
|---------|-------------------------------|---------------------------|
| Typed extractors | Ready | Ready (pure) |
| Acquisition + fact persistence | Ready via fixture transport | **Blocked** — live `WarcraftLogsProvider` lacks first-class `RANKING_PARSE` / points-and-damage; shared-event path needs Live GraphQL validation |
| Experience history | Ready when Blizzard/RIO provider states + runs (+ RIO payload) exist | Ready for exposure/previous-season when those rows exist; elite titles still unavailable |
| Shadow finalization | Ready | Ready once facts/history are present |
| Publication | Forbidden | Forbidden |

## Remaining production blockers

1. **Live RANKING_PARSE / points-and-damage** — not exposed on `WarcraftLogsProvider`; production Performance acquisition returns capability-absent UNAVAILABLE until transport implements the planned datasets.
2. **Live shared-event dataset transport** — production shared evidence requires `getGraphQlClient()` + ingest path validation under rate limits; fixture path is proven.
3. **Elite Experience history** — achievements are not persisted; elite component stays `UNKNOWN`.
4. **Active/draft model-config injection** — `CALIBRATION_V2_ACTIVE_DRAFT_ARCH_BLOCKER` (see [scoring-v2-runbooks.md](../operations/scoring-v2-runbooks.md)).

## Gates before enabling flags

Do **not** flip these until product cutover explicitly authorizes each step:

| Flag | Prerequisite |
|------|----------------|
| `SCORING_V2_EVIDENCE_FETCH_ENABLED` | Live provider transport implements planned datasets; budget/admission guards verified; fixture + disposable E2E green |
| Dimension computation flags (`SCORING_V2_DIMENSIONS_*` / per-dimension) | Evidence fetch path stable; shadow rows reviewed; publication still off |
| `SCORING_V2_PUBLICATION_ENABLED` | Explicit publication cutover prompt; public pointer policy; never enable for Phase 1 shadow |
| `CALIBRATION_V2_ENABLED` | Active/draft injection blocker cleared |

Default for all of the above remains **false**.

## Prompt 13

Prompt 13 may **begin** after CP4 passes for analysis/context work.

Production activation (live fetch, publication, calibration enablement) remains **forbidden** until the production blockers and flag gates above are cleared by an explicit cutover prompt.
