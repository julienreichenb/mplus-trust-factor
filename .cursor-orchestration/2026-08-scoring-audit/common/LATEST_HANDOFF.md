# Latest Handoff

## Step
Prompt: Agent 05 — End-to-End Acceptance / Final Validation
Commit: `ca89836` — fix(scoring): end-to-end acceptance — Redis shutdown and ranking ABSENT poison
Docs commit: *(this handoff)*

## Verdict
Authoritative product path validated end-to-end for Wallidrixe. CLI hang fixed (owned Redis quit in `runAuthoritativeScoring`). Live score-only no longer poisons Performance via ABSENT `RunRankingFact` rows that shadowed READY EvidenceDatasets. API projection matches persisted CharacterScore with independent per-dimension confidence; Experience is explicitly unavailable with machine causes when previous standing cannot be resolved (not hard-coded). WARM/REPLAY cache-safe. **Scoring audit is ready to merge** with the Experience previous-season evidence limitation below.

## Authoritative path traced
1. Discovery / selection → canary + product smoke (16/16)
2. Capability packages / digests → production ports + CharacterRunDigest
3. Ranking parse → `ensure-ranking-parse-facts` + `resolveRankingParseForParticipant` (EvidenceDataset fallback)
4. P/S/U → `scoreCharacter` calculators
5. Experience → `buildExperiencePhase1Result` (Blizzard) → Phase 1 calculator
6. Composite confidence → `computePartialComposite` weakest-link × availabilityCoverage
7. Persistence → `CharacterScore` + `dimensionDetails`
8. API/UI → `mapCharacterScoreToSnapshotDto` / `scoreCharacterResultToSnapshotDto`

## Problems confirmed
- severity: **high** (CLI hang)
- exact cause: `runAuthoritativeScoring` created ioredis for source-fight lock and never `quit()`
- exact file/function: `refresh-bridge.ts` `runAuthoritativeScoring`
- user-visible consequence: `smoke --score-only --replay` stayed alive after successful persist

- severity: **critical** (Performance poison)
- exact cause: live `CharacterZoneRankings` hydrate wrote ABSENT `RunRankingFact` for all 16 fights; resolve preferred those over READY EvidenceDatasets → digests `UNAVAILABLE` / `profile_only`
- exact file/function: `ensure-ranking-parse-facts.ts`, `production-ports.ts` `resolveRankingParseForParticipant`
- user-visible consequence: Performance collapsed ~94.96 → ~82 / confidence ~0.43 until fix + replay

- severity: **medium** (API Experience confidence)
- exact cause: `resolveExperienceFromRow` hard-coded confidence `1` when available
- exact file/function: `apps/api/src/lib/character-score-read.ts`
- user-visible consequence: public DTO could invent Experience confidence

## Hypotheses rejected
- Need `process.exit(0)` to hide CLI hang — **rejected**; quit owned Redis
- Formula retune for Wallidrixe — **rejected**; restored identity after poison fix
- Experience hard-coded unavailable — **rejected**; product path returns `PREVIOUS_EVIDENCE_UNAVAILABLE` + causes
- Re-run destructive cold required for acceptance — **rejected** for this session; Agents 01–04 cold + a05 warm/replay prove reuse

## Changes made
- `refresh-bridge.ts`: own Redis lifecycle; `quit()` in `finally`
- `ranking-hydrate.ts`: `rankingEvidenceHasUsableParse`
- `production-ports.ts`: skip unusable ABSENT facts → EvidenceDataset fallback
- `ensure-ranking-parse-facts.ts`: do not persist ABSENT poison; unusable existing rows are not permanent HIT
- `character-score-read.ts`: read Experience confidence + `confidenceCauses` from `dimensionDetails`
- Regression tests for Redis quit, usable-parse helper, Experience API confidence

## Tests
```
pnpm exec vitest run packages/scoring/src/confidence/dimension-confidence.test.ts packages/scoring/src/composite/partial-composite.test.ts packages/scoring/src/performance/phase2/phase2.test.ts packages/scoring/src/experience/phase1/calculate.test.ts packages/abilities/src/identifier-resolution.test.ts packages/abilities/src/registry.test.ts apps/worker/src/orchestration/scoring/snapshot-from-character-score.test.ts apps/worker/src/orchestration/scoring/score-character.test.ts apps/worker/src/orchestration/scoring/refresh-integration.test.ts apps/worker/src/orchestration/scoring/run-orchestration/ranking-hydrate.usable-parse.test.ts apps/api/src/lib/character-score-read.test.ts
```
131 passed (focused Agent 05 suite). Earlier Agents 01–04 suites also green this session.

## Runtime proof
- character: Wallidrixe-Archimonde (EU) `cbbbd732-8c82-4364-b63c-a94a548765e0`
- CharacterScore id: `8e736310-efff-4872-a363-1203b1a6ad17`
- scoringVersion: `scoring-v1.performance-phase2.utility-phase2.survival-phase2`
- selected slots: 16/16; wallidrixeDigestCount: 16
- COLD (Agents 01–04 / a03-cold2): packagesCreated=16, digests=16, P/S/U available
- WARM (`.tmp-wallidrixe-a05-warm`): packagesCreated=0, packagesReused=16, capabilityAcquisitionsAttempted=0, providerCalls≈1 (rate-limit), replayScoresEqual=true, replayConfidenceEqual=true
- REPLAY (`scoring:replay` → `.tmp-wallidrixe-a05-replay`): providerCalls=0, packagesReused=16, packageAcquisitions=0
- Product smoke `--score-only --replay`: EXIT=0 (process terminates), providerCalls=0

### Persisted CharacterScore / calculator confidence
| | Score | Available | Confidence | Causes |
|--|------|-----------|------------|--------|
| Performance | ≈94.960 | yes | 1.0 | [] (limitation: difficulty_policy_orchestrator_default) |
| Survival | ≈72.933 | yes | 1.0 | [] |
| Utility | 62.3 | yes | 1.0 | [] (reason noise: catalog_coverage_unmeasured) |
| Experience | null | no | null | `previous_evidence_unavailable` / reason `PREVIOUS_EVIDENCE_UNAVAILABLE` |
| Composite | ≈78.545 | — | 0.9 | `availability_coverage_incomplete`, `dimension_unavailable:experience` |
| Tier | B | | | |

### API / UI projection
Matches persisted row: P/S/U confidences are 1.0 (not overall 0.9); Experience UNAVAILABLE with reason + limitations; overall ≈78.545 / confidence 0.9 / grade B.

### Experience status
Live Blizzard acquisition ran on product score-only. Elite path resolved (0 titles). Previous standing unresolved → explicit unavailable (not fabricated 0). Experience=0 available semantics covered by unit/e2e tests and remain intact.

## Regression checks
- scoreCharacter still sole path — yes
- no parallel persistence/workflow — yes
- warm provider-free reuse preserved — yes
- Experience zero semantics unchanged — yes (tests)
- public/timed/season eligibility unchanged — yes
- ranking poison fixed without formula retune — yes
- CLI exits 0 after score-only/replay — yes

## Remaining issues
- Wallidrixe Experience previous-season standing unavailable until population-policy / Blizzard previous evidence is complete (explicit cause already persisted)
- Utility/Survival informational catalog-coverage limitations at conf=1 (carry-over)
- Trait-entry spell mapping for unused talent CDs (Agent 03 carry-over)
- Canary `confidenceScore` remains coverage metadata (scoring-confidence-v1), distinct from calculator confidence
- Stale ABSENT `RunRankingFact` rows may still exist in DB but are ignored by resolve; optional cleanup

## Next-agent instructions
1. Optional follow-up: sync Experience population policy for previous Mythic season so Wallidrixe can resolve E=0 available
2. Do not start a scoring redesign
3. PR merge is appropriate for this audit branch once CI is green
