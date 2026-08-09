# Agent 01 — Canonical Experience Replay + Provider Accounting

## Mission

Fix the production-facing scoring entry so persisted Experience evidence is actually usable when provider calls are disabled, without touching P/S/U behavior.

Also repair Experience provider-call accounting.

## Read first

- `../common/GLOBAL_DIRECTIVES.md`
- `../common/REVIEW_FINDINGS.md`
- `../common/LATEST_HANDOFF.md`

Inspect at minimum:

- `apps/worker/src/orchestration/scoring/refresh-bridge.ts`
- `apps/worker/src/orchestration/scoring/experience-phase1.ts`
- `apps/worker/src/orchestration/scoring/score-character.ts`
- relevant recalculate/replay entry points and tests

## Root cause to prove before editing

Verify whether `runAuthoritativeScoring()` skips `buildExperiencePhase1Result()` entirely when `allowExperienceBlizzardProviderCalls(env)` is false.

Trace at least:
1. operational live refresh;
2. recalculation/replay with provider calls disabled;
3. fixture/test mode if supported.

Document the exact call graph in `LATEST_HANDOFF.md`.

## Required behavior

Refactor the gating so that:

- Experience reconstruction/evaluation can run from durable persistence even if providers are forbidden;
- `allowProviderCalls=false` reaches `buildExperiencePhase1Result()` when the evidence store can be read;
- missing evidence with providers forbidden yields explicit unavailable Experience;
- existing persisted evidence with providers forbidden yields the same available Experience as warm live mode;
- no Blizzard/Raider.IO/WCL call is made merely to reconstruct persisted Experience.

Do not create a second Experience calculation path.

Prefer:
- one call to `buildExperiencePhase1Result()`;
- provider permission passed into it as a boolean;
- nullable/disabled provider ports only where necessary.

## Provider accounting

`runAuthoritativeScoring().providerCalls` must account for all Experience calls performed by this path, including:
- Blizzard previous season profile;
- Blizzard achievements;
- Raider.IO exact historical rating fallback.

Do not double-count calls already included by the main scoring orchestration.

## Regression tests

Add focused tests proving:

### A. Canonical provider-free replay
Cold:
- persisted evidence absent;
- providers permitted;
- Experience acquired and persisted.

Replay:
- invoke the canonical `runAuthoritativeScoring()` path;
- providers forbidden;
- same evidence store/DB rows available;
- Experience score/state/confidence/provenance identical;
- historical provider calls = 0.

The test must fail against PR #84 behavior.

### B. Cache miss with providers forbidden
- no evidence row;
- providers forbidden;
- Experience unavailable with explicit evidence-missing reason;
- P/S/U still compute exactly as before.

### C. Accounting
- forced Blizzard failure + exact RIO fallback;
- expected total providerCalls includes the RIO historical call.

## Do not

- do not change season binding;
- do not change cutoff policy semantics;
- do not change persisted evidence schema;
- do not change Experience scores;
- do not change P/S/U.

## Validation

Run focused tests plus relevant worker scoring tests.

Update `LATEST_HANDOFF.md` with:
- root cause;
- files changed;
- exact gating behavior before/after;
- provider accounting before/after;
- tests;
- commit SHA;
- blockers for Agent 02.

Commit and stop.
