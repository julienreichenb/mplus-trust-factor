# M+ Trust Factor — Experience Evidence Completion

## Objective

Complete the Experience dimension after the scoring-audit chantier.

The previous chantier made the P/S/U path deterministic and auditable. The remaining product gap is Experience: the current real-character path can still end in `PREVIOUS_EVIDENCE_UNAVAILABLE`, and Experience evidence does not yet have the immutable persistence / provider-free replay lifecycle required by the product.

This chantier must make Experience:

- season-correct;
- based on the real previous Mythic+ season, never event/intermediate seasons;
- dynamically rollover-safe without hard-coded current season IDs/slugs;
- persistent, because completed-season evidence is immutable;
- provider-efficient: historical evidence is acquired once and reused;
- provider-free on warm/replay;
- explicit about Blizzard authority vs exceptional Raider.IO fallback;
- based directly on Raider.IO native cutoff bands rather than a second invented percentile grid;
- isolated from P/S/U formulas and evidence.

## Worktree / branch

One chantier, one branch, one worktree. Run agents sequentially in the same worktree.

Suggested PowerShell:

```powershell
cd "C:\Users\julie\VS Projects\mplus-trust-factor"

git switch main
git pull --ff-only origin main

git worktree add `
  "C:\Users\julie\VS Projects\mplus-worktrees\experience-evidence" `
  -b fix/experience-evidence-completion main

cursor "C:\Users\julie\VS Projects\mplus-worktrees\experience-evidence"
```

## Agent order

1. `01-audit-season-and-provider-semantics.md`
2. `02-build-dynamic-real-season-binding.md`
3. `03-persist-immutable-experience-evidence.md`
4. `04-native-cutoff-scoring-and-edge-cases.md`
5. `05-end-to-end-rollover-acceptance.md`

Do not skip agents. The same worktree is reused throughout.

## Launcher pattern

For each agent:

```text
Read these files first and treat them as mandatory instructions:

.cursor-orchestration/2026-08-experience-evidence-completion/common/GLOBAL_DIRECTIVES.md
.cursor-orchestration/2026-08-experience-evidence-completion/common/PRODUCT_DECISIONS.md
.cursor-orchestration/2026-08-experience-evidence-completion/common/AUDIT_BASELINE.md
.cursor-orchestration/2026-08-experience-evidence-completion/common/LATEST_HANDOFF.md

Then execute:

.cursor-orchestration/2026-08-experience-evidence-completion/prompts/0X-....md

Continue in the current worktree and branch.
Do not create another branch or worktree.
Commit the completed step and update LATEST_HANDOFF.md.
Do not start the next agent.
```

## Exit condition

The chantier is merge-ready only when all of these hold:

- current Mythic+ season comes from the existing authoritative dynamic season mechanism, not a Midnight S1 constant;
- immediately previous **real** Mythic+ season is resolved dynamically across same-expansion and cross-expansion rollovers;
- Raider.IO event/intermediate seasons cannot become the product's previous season;
- previous-season score uses Blizzard first and Raider.IO only as an explicit exceptional fallback;
- a successfully resolved historical character-season score is persisted and is not automatically fetched again;
- previous-season regional class rank is demonstrably tied to that exact real season;
- previous-season population cutoff evidence is season+region bound and persisted;
- Experience can be recalculated from persistence without WCL, Blizzard or Raider.IO calls;
- confirmed no activity is `E=0`, available;
- provider/config/integrity failure is unavailable, never fabricated zero;
- season rollover invalidates only evidence whose current/previous season pair changed;
- API / CharacterScore projection remains correct;
- P/S/U scores, confidence and COLD/WARM/REPLAY invariants do not regress.

## Important note on "native Raider.IO cutoffs"

Do not invent a second percentile system.

The existing provider currently exposes native Raider.IO quantiles such as `p999`, `p990`, `p900`, `p750`, `p600`. The implementation must treat native provider cutoff identity as the source of truth and avoid deriving unsupported percentile positions.

The agent must first verify the live/provider contract before changing the scoring mapper. Do not hard-code a new list merely because these are the current fixture keys if the provider exposes a more canonical typed representation.
