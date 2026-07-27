# Wave 4 — Agent sequence and integration plan

## Branch strategy

Create `integration/wave4` from the final Wave 3 master tag.

Suggested worktrees:

- `agent/w4-data-foundation`
- `agent/w4-performance`
- `agent/w4-survival`
- `agent/w4-utility`
- `agent/w4-experience`
- `agent/w4-product-ux`
- `agent/w4-calibration-integration`

## Dependency graph

```text
Agent 21 data foundation
 ├─ Agent 22 Performance
 ├─ Agent 23 Survival
 ├─ Agent 24 Utility
 ├─ Agent 25 Experience feasibility
 └─ Agent 26 Product UX (after contract/mocks freeze)

22 + 23 + 24 + 25 + 26
 └─ Agent 27 calibration, bias audit and final integration
```

## Merge gates

### Gate A — Agent 21

- exactly one selected run per active-season dungeon;
- versioned ability/mechanic catalog schemas;
- sanitized Wallidrixe eight-run smoke;
- data gaps documented;
- no score formula change yet.

### Gate B — Dimension agents

Each dimension must provide:

- raw facts;
- formula and internal weights;
- confidence formula;
- missing-data behaviour;
- per-run explanation DTO;
- tests and Wallidrixe smoke output;
- model v3 compatibility.

### Gate C — UX

- approved responsive landing;
- profile IA centered on score;
- collapsible secondary details;
- no frontend score calculations;
- fixtures for all dimension states.

### Gate D — Agent 27

- cohort calibration across classes/roles/key bands;
- bias report;
- score model v3 seed;
- clean migrations and build;
- live regression matrix;
- GO/NO-GO.

## Non-goals for Wave 4

- Public launch monetization.
- Full account graph without user consent/provider support.
- Perfect mechanic-opportunity detection.
- Wowhead dependency.
- 3D character rendering.
- Raid scoring.
