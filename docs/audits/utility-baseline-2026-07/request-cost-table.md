# Utility baseline — request cost table

Conservative planning table. Runtime prefers measured `rateLimitData` delta or per-request `costUnits`. Unknown cost must stay `null` (never coerced to 0).

| Operation | Typical requests | Typical pages | Conservative points | Notes |
|-----------|------------------|---------------|---------------------|-------|
| masterData | 1 | 1 | 1 | Often reusable within report revision |
| Casts (Friendlies) | 1–N | 1–8 | pages × 1 | Shared with Survival |
| HostileCasts (Enemies) | 1–N | 2–20+ | pages × 1 | **Utility-only; usually largest incremental cost** |
| Interrupts | 1–3 | 1–3 | pages × 1 | Utility-only; party-wide |
| Dispels | 1–2 | 1–2 | pages × 1 | Utility-only |
| DamageDone | 1–N | 1–10 | pages × 1 | Utility-only |
| Deaths / Buffs / Debuffs / CombatantInfo | 1–N each | 1–4 each | pages × 1 | Overlap with Survival on dual ingest |
| Cold dual-consumer run | ≈10–40+ | ≈10–40+ | pages × 1 est. | Survival+Utility union once |
| Compatible second refresh | 0 | 0 | **0** | Persisted compatibility key hit |
| Utility gap-fill after Survival-only | 4 dataset streams | HostileCasts+Interrupts+Dispels+DamageDone | sum of those pages | Required when Survival-only cache reused |
| Fallback extra run (uncached) | ≈ cold run | ≈ cold run | per extra run | Cap 4; stop when publishable |

Source of truth in code: `UTILITY_BASELINE_REQUEST_COST_TABLE` in `utility-baseline-diagnostics.ts`.
