# Latest Handoff

Status: AGENT 03 COMPLETE — **MERGE READY**

## Baseline

- PR #84 is merged.
- Agent 01 accepted (`062b9cf` — provider-free Experience reconstruction + RIO accounting).
- Agent 02 accepted (season/evidence integrity; chronology-parity tip `77e389e`).
- Agent 03 — final regression / live acceptance (this document).

## Findings fixed (F1–F9)

| ID | Status |
|----|--------|
| F1 canonical provider-free replay | Proven via `runAuthoritativeScoring` cold→warm→replay |
| F2 remapped cutoff fresh policy | Proven: refuse without proof; accept with proof; positive rating → p990 |
| F3 duplicate previous resolution | Proven: fixture pollution cannot poison RIO slug / evidence identities |
| F4 evidence compatibility | Covered by Agent 02 + replay path |
| F5 ensure retry | Covered by Agent 02 F5 (fail→retry→skip) |
| F6 transient vs terminal | Proven through canonical scoring (429/5xx/network vs 404) |
| F7 provider accounting | Exact equality: cold Blizzard=2, cold fallback=3, warm/replay=0 |
| F8 real Prisma restart | Proven on disposable PostgreSQL (not in-memory Map) |
| F9 live-probe footgun | Destructive reset opt-in + production/staging reject |

## Final acceptance matrix

### 1. Canonical cold → warm → provider-free replay

Entry: `runAuthoritativeScoring()` (not phase-1 alone).

| Mode | Historical Blizzard | Historical RIO | Achievements | E | providerCalls |
|------|---------------------|----------------|--------------|---|---------------|
| COLD | 1 | 0 | 1 | 90 (p990) | **2** |
| WARM | 0 | 0 | 0 | identical | **0** |
| REPLAY (`ALLOW_LIVE_PROVIDER_CALLS=false`) | 0 | 0 | 0 | identical | **0** |

P/S/U unchanged across the three runs. Evidence persisted with season=N-1, Blizzard=14, RIO=`season-tww-3`.

### 2. Fresh policy + remapped cutoffs + positive rating

- No pre-existing Experience population LKG.
- `isRemappedSeason=true` refused without `exactTargetSeasonEquivalenceProven`.
- With `proveExactRaiderIoCutoffSeasonEquivalence` → `UPDATED` LKG persisted.
- Positive historical rating 3000 → native band **p990** / score **90**.
- Provider-free replay after persist: 0 historical calls, same E.

### 3. Real persistence / restart

`experience-agent03-persistence.integration.test.ts` on disposable `mplus_itest_*`:

1. Prisma `CharacterExperienceEvidenceRepository.upsertImmutable`
2. `$disconnect` + new `createPrismaClient`
3. `ALLOW_LIVE_PROVIDER_CALLS=false` → `runAuthoritativeScoring`
4. E=90, historical Blizzard/RIO calls = 0

Empty-DB migrate deploy applied all 33 migrations including `20260809180000_character_experience_evidence` (PR #84 schema; no new migration).

### 4. Wrong-season contamination

Canonical scoring with later-starting fixture (`providerSeasonId=season-fixture-poison`):

- RIO exact call uses true previous slug only
- Persisted rating: internal=N-1, Blizzard=14, RIO=`season-tww-3`

### 5. Stale `providerSeasonId` / legacy hardening

Locked by Agent 02 (Agent 03 re-ran suite — 45/45):

- A explicit different Blizzard ID → cannot bind / sync / fallback
- B exact ID + absurd chronology → fresh + legacy reject; slug cleared
- C missing RIO ID → date bind / mismatch / COULD_NOT_REVALIDATE
- D provider/static outage → LKG retained
- E later valid static → can rebind after clear

Chronology-parity functional commit: `77e389e92db817a566a4c72919c3371d581ff735`  
(stale handoff SHA `2be03df…` was superseded / not tip — corrected here).

### 6. Transient vs terminal fallback (canonical)

| Blizzard failure | RIO historical | Immutable RIO rating | Retry Blizzard later |
|------------------|----------------|----------------------|----------------------|
| 429 / RATE_LIMITED | 0 | none | yes |
| 5xx | 0 | none | yes |
| retryable network | 0 | none | yes |
| terminal 404 | 1 | persisted RAIDERIO_FALLBACK | n/a |
| successful Blizzard | 0 | BLIZZARD wins | n/a |

Note: elite achievements alone may still yield E=90 (elite floor) when standing is unresolved; rating evidence is not persisted on transient failures.

### 7. Rollover / ensure retry

- Same-process N→N+1: stale N-1 evidence does not satisfy new previous N; Blizzard called for season 15.
- Ensure fail→retry→success→skip: Agent 02 F5 (re-verified in Agent 03 suite run).

### 8. Provider call accounting

- Cold Blizzard success: `providerCalls === 2` (profile + achievements; P/S/U=0 with memory ports).
- Cold terminal fallback: `providerCalls === 3` (+ RIO historical).
- Warm / provider-free: `providerCalls === 0`.

### 9. P/S/U non-regression

- `score-character.test.ts`, `refresh-integration.test.ts`, Experience e2e: **passed**.
- Canonical cold/warm/replay: P/S/U byte-identical across runs.
- Live Wallidrixe P≈94.960 / S≈72.933 / U=62.3: **not re-measured** (no local provider credentials / `.env`). Fixture regressions did not alter P/S/U formulas.

### 10. Class-rank limitation (remaining scope)

Previous-season regional class rank remains **fail-closed** unless exact-season provenance exists.  
`refresh-bridge` passes `exactSeasonProven: false`. Generic RIO `previousRanks` must not become trusted. Acceptable remaining scope — not claimed fixed.

### 11. Live-probe safety

- Destructive evidence delete requires `EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET=true`
- Rejects `APP_ENV` in `{production, staging}`
- Normal invocation does not delete evidence
- Guard unit test included

### 12. CI / validation results

| Check | Result |
|-------|--------|
| lint | pass |
| typecheck | pass |
| build | pass (fixed Agent 02 TS `never` on `previousExpansionSeasons?.length`) |
| Experience + scoring suites | **174 passed** (13 files) |
| Prisma validate | pass (schema valid) |
| Disposable empty-DB migrate | pass (33 migrations) |
| Agent 03 Prisma integration | **pass** (disposable DB) |
| format:check (CI subset) | pre-existing prettier drift in infra/workflows — **not introduced** |
| Live Wallidrixe | **skipped** — no `.env` / credentials; cold would need destructive reset |

### 13. Files changed (Agent 03)

- `apps/worker/src/orchestration/scoring/experience-agent03-acceptance.test.ts` (new)
- `apps/worker/src/orchestration/scoring/experience-agent03-persistence.integration.test.ts` (new)
- `apps/worker/src/orchestration/scoring/experience-agent05-live-probe-guards.ts` (new)
- `apps/worker/src/orchestration/scoring/experience-agent05-live-probe.ts` (destructive opt-in)
- `apps/worker/src/orchestration/scoring/refresh-bridge.experience-replay.test.ts` (exact providerCalls)
- `apps/worker/src/orchestration/scoring/experience-season-bootstrap.ts` (TS build fix)
- `.cursor-orchestration/.../common/LATEST_HANDOFF.md` (this report)

### 14. Commits

- Agent 01: `062b9cfad4757a388150271081d75f10c13752d2`
- Agent 02 primary: `2c08699edfb77aede081386c168e326bd704d7ff`
- Agent 02 corrective (id-mismatch): `0159f6a31695196f31c8be3dd18b6abee94c8675`
- Agent 02 corrective (stale slug + exact-id chronology): `1fb57a83ad09daf5ccdbe8a43f06243934254dae`
- Agent 02 corrective (revalidation chronology parity): `77e389e92db817a566a4c72919c3371d581ff735`
- Agent 03 functional: _(recorded after commit)_

### 15. Remaining known limitations

1. Previous regional class rank still fail-closed without exact-season provenance (by design).
2. Incompatible immutable evidence rows are ignored for scoring but not deleted.
3. Live Wallidrixe non-destructive warm/replay not executed in this environment (no credentials).
4. No process-level full OS restart of PostgreSQL — client disconnect/reconnect on disposable DB is the strongest practical proof.

### 16. Verdict

**MERGE READY**
