# GLOBAL DIRECTIVES — Scoring Stabilization (2026-08)

## Chantier posture

- **Agent 01 = diagnostic only.** No scoring behavior changes.
- Authoritative P/S/U/E pipeline and WCL acquisition must not regress.
- `scoreStory` and `confidenceStory` remain separate. Confidence limitations are not player weaknesses.
- Code wins over docs when they disagree.

## Locked semantics (do not “fix” by relaxing)

| Area | Lock |
|------|------|
| Formulas / weights / thresholds / caps | Unchanged without explicit prompt |
| Utility domain contribution cap (=8) | Do not raise/lower as a “display fix” |
| Experience E=0 | Only for confirmed no historical activity |
| Experience unavailable | Technical/provider/config/binding/integrity failure → null |
| Experience authority | Blizzard primary; Raider.IO exact-season fallback only |
| Historical Experience evidence | Immutable once successfully persisted |
| Current Exposure | Not part of Experience |
| Model activation | DB/admin lifecycle — not env flips |

## Forbidden without explicit prompt

- Changing score formula, weights, thresholds, confidence formulas
- Changing Utility curves/caps or Experience semantics
- Changing provider contracts or refresh behaviour semantics casually
- Deleting Utility/Survival research probes
- Starting Agent 02 before human UI baseline gate

## Agent boundaries (recommended)

| Agent | Scope |
|-------|--------|
| **01** | Forensic RCA + regression tests freezing current behavior + handoff docs |
| **02** | Public search / eligibility evidence repair path |
| **03** | Utility explainability / cap presentation (if product wants uncapped evidence surfaced) — **not** changing the cap unless explicitly approved |
| **04** | Performance cooldown confidence / loadout-spec extraction |
| **05** | Experience population-policy ensure + diagnostics persistence |

## Diagnostic tooling

```bash
# Provider-free local dump (requires Character already in DB)
pnpm scoring:diagnose:stabilization -- --region EU --realm <realm> --character <Name>
```

Env fallbacks: `STABILIZATION_DIAG_REGION`, `STABILIZATION_DIAG_REALM`, `STABILIZATION_DIAG_CHARACTER`.
