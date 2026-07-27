# Agent 21 — Scoring v3 Data Foundation & Wallidrixe Smoke

You are Agent 21. Work from `integration/wave4`.

Primary objective: create the shared eight-run scoring dataset and prove every proposed v3 metric can or cannot be collected before changing score weights.

Requirements:

1. Resolve the active season and expected dungeon set.
2. Select exactly one canonical run per dungeon: highest key, then run score/timed state, then latest.
3. Do not replace an unlogged highest run with a lower logged run. Mark detail unavailable and reduce confidence.
4. Introduce typed `ScoringRunSelection`, raw Survival facts and raw Utility facts.
5. Add versioned `AbilityRule` and `MechanicRule` schemas, loaders and validation. Seed only a bounded initial set needed for live validation; do not scatter spell IDs through code.
6. Extend a sanitized deep smoke for EU/archimonde/Wallidrixe to emit all required raw facts for the eight selected runs:
   - parse and key-difficulty inputs;
   - deaths and damage taken;
   - avoidable damage classification coverage;
   - personal defensives, self-heals and healing potion;
   - kick casts, successful interrupts and effective cooldown;
   - distinct CC targets;
   - group-support casts;
   - defensive/offensive dispels;
   - missing/rejection reasons and API point cost.
7. Verify WCL event pagination and bounded query cost.
8. Persist raw facts with source, run, formula/catalog version and observedAt.
9. Do not modify the current score model.
10. Produce `doc/wave4/data-coverage-wallidrixe.md` with AVAILABLE / PARTIAL / BLOCKED for every required metric.

Tests:

- eight unique dungeons;
- deterministic tie-breaking;
- missing WCL on highest run;
- event pagination;
- pet/player attribution;
- catalog version validation;
- secret/report-code sanitization;
- no out-of-season runs.

Delivery: commit, files, tests, sanitized smoke, provider cost, blockers and contract freeze recommendation for Agents 22–26.
