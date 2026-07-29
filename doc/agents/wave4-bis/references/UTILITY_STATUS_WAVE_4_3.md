# Utility Status Reference

Utility is not production-ready.

Relevant commits:

- `2587b14`: cross-class validation resume/report fixes;
- `d83b39b`: panel replacement with Haart and Moosevoker;
- `89d0986`: V3.1 offline calibration;
- `4c7dd4a`: V3.2 opportunity-engine audit.

Latest proven blocker:

- persisted Utility Casts include friendly player casts only;
- hostile NPC cast starts/completions are missing;
- no confirmed interrupt opportunity denominator exists;
- confirmed misses cannot be calculated safely;
- further scoring-curve tuning should wait.

Agent 35 should continue shared run selection, shared evidence bundles, hostile cast ingestion, durable reuse, controlled backfill and offline recalibration.

Wave 4.3 agents must not integrate Utility.
