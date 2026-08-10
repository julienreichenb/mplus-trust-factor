# LATEST HANDOFF — Agent 01 (diagnostic)

**Branch:** `fix/scoring-stabilization`  
**Worktree:** `mplus-worktrees/scoring-stabilization`  
**Status:** Agent 01 complete — STOP before Agent 02. Human UI baseline gate required.

## What Agent 01 delivered

1. Forensic RCA for all four production-facing problems (see `DIAGNOSTIC_FINDINGS.md`).
2. Focused regression tests freezing **current** (faulty or designed-but-surprising) behavior.
3. Provider-free read-only CLI: `pnpm scoring:diagnose:stabilization -- --region … --realm … --character …`
4. Manual UI baseline checklist for the human gate.

## Tests run

```text
pnpm exec vitest run \
  apps/api/src/services/character-bootstrap-repair.test.ts \
  apps/worker/src/orchestration/character-public-bootstrap.keystone-collapse.test.ts \
  packages/scoring/src/utility/v2/utility-v2.test.ts \
  packages/scoring/src/performance/phase2/phase2.test.ts \
  packages/scoring/src/experience/phase1/calculate.test.ts \
  apps/worker/src/orchestration/scoring/experience-agent02-integrity.test.ts \
  -t "scoring-stabilization|domain contribution cap|keystone collapse|MISSING_POPULATION_POLICY|confirmed no activity|NO_USABLE_POLICY currently|offensive cooldown eligibility|complete shell \+ missing season"

→ 6 files, 19 passed, 127 skipped
```

## Do not start Agent 02 until

1. Human completes the **Manual UI baseline checklist** in `DIAGNOSTIC_FINDINGS.md`.
2. Optional: run `scoring:diagnose:stabilization` on Wallidrixe, Lfgmasochist, Warrior, and fourth representative (if present locally) and attach JSON dumps to the gate notes.

## Agent 02 entry point (eligibility only)

Fix boundary is documented in `DIAGNOSTIC_FINDINGS.md` §6. Highest-leverage eligibility fixes:

- Distinguish keystone **failure** from proven **null rating**.
- Allow repair / evidence refresh when complete shell lacks authoritative-season M+ evidence (without treating all complete characters as always needing Blizzard).
- Keep worker gate provider-free; repair belongs on exact resolve / owned discovery / explicit forceRetry paths.

## Deviations

- Live local matrix for Wallidrixe / Lfgmasochist captured in `live-local-matrix.json` (provider-free DB dump).
- Problem 3 revised: Lfgmasochist cooldown coverage is full; Phase1 profile_only drives low confidence.
- Problem 4 revised: Lfgmasochist has no previous rating evidence row; season-15 policy is COMPLETE locally.
- Dual `isCurrent` seasons observed locally (`placeholder-current` + `blizzard-season-17`).
