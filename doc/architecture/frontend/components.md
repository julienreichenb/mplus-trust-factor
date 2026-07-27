# Frontend components

## Layout

- `App.vue` — brand shell, primary nav, API mode pill
- Pages under `src/pages/`

## Shared

- `SkeletonBlock` — loading placeholders
- `StatusBanner` — info/warn/error/success banners (`aria-live`)

## Profile

- `ScoreHeader` — Trust Factor, grade (letter + text), confidence, freshness, refresh
- `TrustRadarChart` — ECharts radar + accessible table
- `DimensionCards` — score / weight / confidence / contributors
- `AuthenticitySection` — authenticity score + probabilistic wording
- `RedFlagsList` — public flags; never asserts “bought a boost”
- `AnalyzedRunsSection` — latest/highest with same-run dedupe (`kind: BOTH`)
- `EquipmentSeasonSection` — gear/talents + season summary
- `SourcesAttribution` — providers + conditional Raider.IO attribution

## Charts

- `TrustRadarChart` — fixed 0–100 axes; stable dimension order; series toggles for compare

## Admin

Inline editor on `AdminModelsPage` (list, clone, weights, nested metrics, thresholds, validate, backtest, activate).
