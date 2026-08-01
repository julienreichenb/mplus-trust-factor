---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Decisions and open questions

## Accepted decisions

1. Target two WCL runs per active dungeon.
2. One shared immutable selected-run manifest feeds Performance, Survival, and Utility.
3. Run selection is based on key level and technical validity, never resulting behavior.
4. WCL profile summary remains a stabilizer for Performance.
5. Missing evidence reduces confidence or blocks publication; it is not zero.
6. Raw WCL events move to compressed artifacts; normalized facts remain in PostgreSQL.
7. Provider calls are excluded from score replay and calibration.
8. Calibration is adapted to V2 frozen manifests/fact sets.
9. Existing test persistence/models may be destructively replaced.
10. Population-relative comparisons are progressive and critical-mass gated.
11. Phase 1 Utility remains observed-positive-contribution until opportunity modeling.
12. Relative damage starts shadow-only.
13. Raider.IO is optional and used only where Blizzard/WCL/local data is insufficient.
14. Every semantic layer is versioned and immutable.

## Open questions requiring probes/calibration

### WCL

- Exact stable field carrying same-key `key %` for all roles/specs.
- Whether WCL tables materially reduce cost for group DamageTaken and cast volumes.
- Cost behavior when batching multiple fight IDs.
- Report archive/access behavior for target account plan.
- Reliable current-partition binding for `points_and_damage`.
- Tank and healer Performance semantics.

### Scoring

- Final high-key multiplier curve.
- Performance detailed/profile blend.
- Survival relative-damage fairness and weight.
- Utility attempt/overlap credits and saturation curves.
- Experience title and historical-rank weights.
- Overall rank thresholds and confidence caps.

### Data

- Artifact storage backend for production.
- Retention duration by dataset.
- Whether to retain normalized report actors centrally.
- Maximum fact-set and calibration bundle sizes.
- Hard reset versus dual-write timing.

### Population comparison

- Final critical-mass thresholds.
- Account deduplication availability before OAuth adoption.
- Region-specific versus global reference policies.
- Reference snapshot refresh cadence.
- Cohort source governance.

## Decision record template

```md
## ADR-XXXX — Title

- Date:
- Status: proposed | accepted | superseded
- Owners:
- Context:
- Decision:
- Alternatives:
- Consequences:
- Migration:
- Rollback:
- Required version bumps:
- Evidence/tests:
```

## Required pre-implementation probes

1. Run WCL 2×8 selection simulator on at least:
   - complete high-log profile;
   - sparse profile;
   - hidden/archived fallback profile;
   - tank;
   - healer.
2. Compare WCL table versus event aggregates.
3. Measure event cost and payload size per dataset.
4. Validate same-key parse field.
5. Validate Blizzard prior-season and achievements states.
6. Verify calibration V2 bundle sizing using 40-member cohort.
