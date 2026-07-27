# Calibration plan

Future workflow before promoting model versions beyond v1 hypotheses:

1. **Expert labels** — Experts score a cohort of characters/runs (skill order, authenticity suspicion, role notes).
2. **Rank correlation** — Compare model orderings to expert orderings (Spearman / pairwise).
3. **Boost false positives** — Track `BOOST_SUSPECTED` precision/recall against expert suspicion labels; tune thresholds.
4. **Distribution checks** — Score histograms by role/spec; detect meta bias (non-meta strong players should be able to outrank weak meta players).
5. **Coverage stress** — Sparse vs complete profiles; verify shrinkage toward 50, not 0.
6. **Version gate** — Promote `key/version` only after backtest passes agreed thresholds; keep prior model readable for reproducibility.

Golden fixtures under `tools/fixtures/scoring/` are synthetic and are **not** a substitute for expert calibration.
