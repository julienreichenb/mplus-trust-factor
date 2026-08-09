# Agent 03 — Final Regression + Canonical Acceptance

## Mission

Audit the completed hardening end-to-end and decide whether it is truly merge-ready.

Do not add new product behavior unless required to fix a failing acceptance criterion.

## Read first

- `../common/GLOBAL_DIRECTIVES.md`
- `../common/REVIEW_FINDINGS.md`
- `../common/LATEST_HANDOFF.md`
- Agent 01 and Agent 02 commits/diffs

## Acceptance matrix

### 1. Canonical cold / warm / replay

Exercise `runAuthoritativeScoring()` or the actual production-facing equivalent.

Prove:

COLD:
- historical evidence absent;
- providers permitted;
- correct Blizzard-first acquisition;
- RIO exact fallback only when allowed;
- evidence persisted;
- CharacterScore Experience correct.

WARM:
- same character/season;
- successful historical evidence exists;
- historical Blizzard = 0;
- historical RIO = 0;
- achievements = 0 if elite evidence persisted;
- identical E.

REPLAY:
- provider calls forbidden;
- canonical scoring entry still evaluates persisted E;
- Blizzard = 0;
- RIO = 0;
- WCL calls for Experience = 0;
- same E score/state/confidence/provenance;
- P/S/U behavior unchanged.

### 2. Fresh/disposable DB positive historical rating

The review found that Wallidrixe E=0 does not exercise population policy.

Create an integration acceptance using a disposable DB or the repository's real DB test harness:

- no pre-existing Experience population LKG;
- previous season exact RIO binding exists or is bootstrapped;
- historical Blizzard rating is positive;
- RIO cutoffs response is `isRemappedSeason=true`;
- exact Blizzard↔RIO season equivalence is proven;
- LKG policy is persisted;
- standing resolves into the correct native band;
- second/replay calculation needs no historical providers.

This should be a real persistence round-trip where practical, not only a shared in-memory `Map`.

### 3. Wrong-season contamination

Fixture:
- current N;
- true previous N-1;
- later-starting invalid/internal/event row;
- invalid row contains a plausible RIO slug.

Prove:
- previous internal row = N-1;
- exact RIO slug = N-1 slug;
- persisted evidence season/Blizzard/RIO identities all agree.

### 4. Evidence corruption / compatibility

Persist intentionally incompatible rows:
- wrong Blizzard season;
- wrong RIO slug;
- bad content hash.

Providers enabled:
- incompatible row ignored;
- reacquisition happens.

Providers disabled:
- incompatible row does not fabricate a score.

### 5. Transient fallback

Prove:
- Blizzard 429/5xx/network retryable error does not create immutable Raider.IO historical rating evidence;
- subsequent calculation can retry Blizzard;
- terminal supported fallback condition still works and persists once.

### 6. Rollover retry

Same process:
- N→N+1;
- first binding/policy ensure fails transiently;
- second invocation retries;
- successful invocation then enables later skip;
- stale N-1 evidence cannot satisfy new previous N.

### 7. Provider accounting

Cold fallback run must expose correct total calls.
Warm/replay totals must drop appropriately.

### 8. P/S/U regression

Use the established scoring-audit baseline where fixtures/runtime allow it.

Expected Wallidrixe reference from prior audit:
- P ≈ 94.960
- S ≈ 72.933
- U = 62.3

Do not alter formulas to force these values.

### 9. Class rank

Confirm previous regional class rank remains fail-closed unless an exact-season source was actually proven during this chantier.

Do not claim completion if it is still unavailable by design.

### 10. Dangerous diagnostic script

Review `experience-agent05-live-probe.ts`.

If it still deletes durable evidence:
- either move it to an explicitly diagnostic tool location and add a non-production guard;
- or make destructive reset opt-in via an explicit environment flag;
- do not let a normal invocation silently delete shared/prod evidence.

## CI / validation

Run all relevant commands used by repository CI:
- formatting check if applicable;
- lint;
- build;
- typecheck;
- migration validation;
- tests;
- Experience-specific suites;
- any targeted disposable-DB integration.

If real provider credentials are available, perform a non-destructive Wallidrixe live verification. Do not clear persisted evidence unless an explicit safe test DB is being used.

## Final report

Update `LATEST_HANDOFF.md` and provide:

1. findings fixed;
2. unresolved limitations;
3. canonical cold/warm/replay matrix;
4. fresh-DB positive-rating proof;
5. rollover/retry proof;
6. provider accounting proof;
7. P/S/U regression result;
8. migration/CI status;
9. files changed;
10. commit SHA;
11. final verdict: `MERGE READY` or `NOT MERGE READY`.

Commit and stop.
