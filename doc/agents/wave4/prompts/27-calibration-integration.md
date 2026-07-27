# Agent 27 — Scoring v3 Calibration, Bias Audit and Final Integration

Integrate Agents 22–26 after Agent 21 foundation.

Requirements:

1. Create and seed `default@3`; preserve v1/v2 snapshots.
2. Validate dimension/global weights using a diverse cohort:
   - classes/specs/roles;
   - low, medium and high key bands;
   - full, partial and missing WCL coverage;
   - new characters and historical veterans.
3. Detect class capability bias, pet attribution errors, role bias and key-level bias.
4. Verify that eight selected runs are deterministic and no provider duplicates remain.
5. Confirm missing capability renormalization and confidence behaviour.
6. Run live smoke profiles including Wallidrixe, but do not tune solely to one player.
7. Validate landing/profile E2E and responsive states.
8. Produce model documentation with formulas, data sources, catalogs and known limitations.
9. Apply only evidence-based weight adjustments and document every change.
10. Return GO/NO-GO for Wave 4 merge.
