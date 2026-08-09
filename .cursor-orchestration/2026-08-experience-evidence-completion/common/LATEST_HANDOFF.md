# Latest Handoff

## Step
Agent 05 complete — FINAL ACCEPTANCE. **MERGE READY**.

## Product decisions locked
See `PRODUCT_DECISIONS.md`. Agents 01–04 remain authoritative for binding, persistence, and native-band scoring.

## Agent 05 outcomes

### Verdict
**MERGE READY** on `fix/experience-evidence-completion`.

Known acceptable limitation (unchanged): exact previous-season regional class rank remains unavailable — no safely season-bound provider source. Fail-closed (`classRankFloor=null`). Do **not** represent as completed class-rank proof.

### Critical acceptance fix
`resolvePreviousMythicSeason` now requires previous candidates to use Blizzard-authority slug `/^blizzard-season-\d+$/i`. Local fixture seasons (e.g. `pub-cancel-season`) can no longer win chronological previous binding.

### Migration
- Migration: `20260809180000_character_experience_evidence`
- Commands: `prisma migrate status` → Database schema is up to date; `prisma validate` → valid; `node tools/scripts/_agent05-verify-experience-table.mjs` → table + unique identity + FKs + indexes OK
- Local DB: `mplus_trust` @ `127.0.0.1:5433`
- No production deploy from this agent

### Wallidrixe (EU / Archimonde) — authoritative path

#### Season identity
| Role | Blizzard id | Internal Season slug / id | RIO slug |
|------|-------------|---------------------------|----------|
| Current | **17** | `blizzard-season-17` / `965c666a-7e90-42d1-8cc8-e9da6467d6d7` | `season-mn-1` |
| Previous | **15** | `blizzard-season-15` / `1e41c326-5ac2-4c3f-883a-11640c7dc7eb` | `season-tww-3` |

Proof no Break-the-Meta/event: previous is real Blizzard season 15 + real RIO `season-tww-3` (main); fixture seasons filtered out.

#### Historical rating chain
1. Persisted miss (cold) / hit (warm)
2. Blizzard historical season 15 → **404**
3. Dedicated exact-season RIO `season-tww-3` → score 0/null + proven no activity
4. State: **`CONFIRMED_NO_ACTIVITY`** / persisted `CONFIRMED_ABSENCE` / source **`RAIDERIO_FALLBACK`**
5. Standing **0** (not special-cased)

#### Population policy
- Region EU, season `season-tww-3`, version `season-population-policy-v2`, quality COMPLETE
- Thresholds: p999=3946.97, p990=3602.13, p900=3114.82, p750=2876.44, p600=2558.75
- No matched native band (no standing rating); policy present for future HAS_VALUE cases

#### Other Experience evidence
- Class rank: unavailable (fail-closed); ambiguous generic RIO previous rank **not** used
- Elite: confirmed absence (0 titles); elite floor not applied

#### Final Experience
- previousStandingScore=0, classRankFloor=null, eliteFloor n/a
- score=0, available=true, confidence=1, causes=[]
- standingProvenance: ratingSource RAIDERIO_FALLBACK (PERSISTED on warm/replay diagnostics), exactHistoricalSeasonSlug `blizzard-season-15`

#### P/S/U / composite / CharacterScore
| Metric | Value | vs AUDIT_BASELINE |
|--------|-------|-------------------|
| Performance | ≈94.960 (conf 1) | match |
| Survival | ≈72.933 (conf 1) | match |
| Utility | 62.3 (conf 1) | match |
| Experience | 0 (conf 1) | was unavailable; now proven E=0 |
| Composite | ≈70.691 (conf 1) | was ≈78.545 with E unavailable — expected |
| Tier | B | same |

CharacterScore id: `8e736310-efff-4872-a363-1203b1a6ad17`  
Character id: `cbbbd732-8c82-4364-b63c-a94a548765e0`  
`dimensionDetails.experience` includes score/confidence/causes/`standingProvenance`.

### COLD / WARM / REPLAY (historical Experience)

| Path | Blizzard hist | Achievements | RIO hist |
|------|---------------|--------------|----------|
| COLD | 1 | 1 | 1 |
| WARM | 0 | 0 | 0 |
| REPLAY | 0 | 0 | 0 |

Experience identical across warm/replay. Season-authority TTL calls may still occur; not counted as historical regression.

### Process-restart persistence
Agent 05 acceptance: shared durable Map + reconstructed in-memory store → hist providers stay 0; process-local ensure not required.

### Future N → N+1 rollover
Invented seasons only (zx-* / 910x). Proves: event never previous; N-1 evidence cannot satisfy N; N evidence under own key; policy isolation; no Midnight hard-codes / id−1.

### Native-band productive path
Discrete bands only; two ratings in same band → same standing; `interpolateTopPercent` / `scoreFromEstimatedTopPercent` not used on productive Experience path (Agent 05 test).

### Validation run
- Worker orchestration/scoring: 63 files / 481 tests passed (2 skipped live)
- Scoring `src/experience`: 104 passed
- API `character-score-read`: 8 passed
- Agent 05 acceptance + previous-season-evidence: passed
- prisma migrate status / validate / table verify: OK
- typecheck: scoring, worker, api, database OK
- build: scoring, worker, api OK
- eslint on Agent 05 touched files: OK
- Full monorepo `pnpm test` / root `pnpm lint` not re-run end-to-end in this turn; focused CI-equivalent suites above are green

### Files (Agent 05)
- `experience-previous-season-evidence.ts` (+ tests) — fixture slug filter
- `experience-evidence-persist.ts` — shared Map for restart sim
- `experience-phase1.ts` — diagnostics typing cleanup
- `experience-agent05-acceptance.test.ts` — rollover / bands / failures / productive path
- `experience-agent05-live-probe.ts` — live COLD/WARM/REPLAY probe
- `tools/scripts/_agent05-verify-experience-table.mjs`
- `FINAL_ACCEPTANCE_MATRIX.md`, `REVIEW_CHECKLIST.md`, this handoff

### Do not
- Open/merge PR unless explicitly instructed
- Change P/S/U formulas
- Claim class-rank completion
- Deploy migration to production from this agent

## Baseline
P/S/U preserved per `AUDIT_BASELINE.md`. Composite changes only because Experience is now available at 0.
