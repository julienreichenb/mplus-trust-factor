# M+ Trust Factor — Experience Post-Merge Hardening

## Objective

Harden the Experience evidence work merged in PR #84 without reopening the scoring model.

This chantier is intentionally narrow. It addresses review findings discovered after merge:

1. canonical provider-free Experience replay is not fully wired through `runAuthoritativeScoring`;
2. historical Raider.IO cutoffs marked `isRemappedSeason=true` can leave a fresh DB without a usable population policy;
3. previous-season resolution is duplicated between `refresh-bridge.ts` and the canonical Experience resolver;
4. persisted immutable evidence is not revalidated strongly enough when read;
5. Experience season-binding ensure state can suppress retry after a partial/failed bootstrap;
6. transient Blizzard failures can become permanently persisted Raider.IO fallback evidence;
7. historical Raider.IO fallback calls are omitted from provider accounting;
8. final acceptance should prove the real canonical path, not only call the Experience builder directly.

## Scope lock

Do NOT retune:
- Performance;
- Survival;
- Utility;
- Experience band scores;
- class-rank floors;
- elite floor;
- Trust Score weights;
- grade thresholds.

Do NOT build frontend explainability.

Do NOT redesign persistence unless a concrete correctness bug requires it.

## Worktree / branch

Use one branch and one worktree for all agents:

- branch: `fix/experience-postmerge-hardening`
- worktree: `C:\Users\julie\VS Projects\mplus-worktrees\experience-hardening`

Run agents sequentially in the same worktree.

## Agent order

1. `prompts/01-canonical-replay-and-accounting.md`
2. `prompts/02-season-evidence-integrity-hardening.md`
3. `prompts/03-final-regression-and-live-acceptance.md`

Do not start the next agent automatically. Each agent commits its own completed work and updates `common/LATEST_HANDOFF.md`.

## Exit conditions

The chantier is complete only when:

- `runAuthoritativeScoring` can reconstruct persisted Experience with provider calls disabled;
- no live provider call occurs in that provider-free path;
- Experience remains identical between cold/warm/replay when evidence already exists;
- the exact same canonical previous-season resolver determines both the internal previous season and its Raider.IO slug;
- wrong-season / stale persisted evidence cannot be silently reused;
- remapped historical cutoffs are either accepted only with explicit exact-season equivalence proof or fail closed with an intentionally supported recovery path;
- a fresh/disposable DB can compute Experience for a synthetic positive historical rating without relying on pre-existing LKG metadata;
- transient Blizzard failures remain retryable and do not permanently lock Raider.IO as source;
- terminal Blizzard historical absence / unsupported-history cases may still use exact-season Raider.IO fallback;
- failed/partial Experience season bootstrap does not permanently mark the current season as ensured;
- provider accounting includes Blizzard + Raider.IO historical Experience calls;
- exact previous-season regional class rank remains fail-closed unless a safe source is actually discovered;
- P/S/U baselines remain unchanged;
- migration state, lint, build, typecheck, tests and existing CI remain green.
