# Agent 23 — Survival v3

Work from Agent 21's merged foundation on `integration/wave4`.

Use only the eight selected highest-key current-season runs.

Initial weights:

- deaths 35%;
- avoidable damage 30%;
- personal defensives 20%;
- self-healing and healing potion 15%.

Requirements:

1. Collect WCL Deaths, DamageTaken, Healing, Casts/Buffs and health/resource context.
2. Avoidable damage must come from a versioned dungeon mechanic catalog. Unclassified damage is not avoidable.
3. Normalize avoidable damage by max health and duration, with cohort comparison when sufficient.
4. Resolve personal defensives and self-heals through the versioned ability catalog.
5. Credit effective self-healing; expose overheal separately.
6. Count healing-potion use.
7. Bound defensive-use credit so meaningless spam cannot create a perfect score.
8. Capability/missing data renormalizes internal weights and lowers confidence.
9. Expose per-run facts and score explanation.
10. Validate Wallidrixe and document catalog coverage gaps.

Do not change Performance, Utility, Experience or UI layout.
