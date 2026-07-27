# Agent 26 — Landing & profile UX handoff

## Commit

See final hash on branch `agent/wave4-ux`.

## What changed

- Landing rebuilt around the Wave 4 brief: sticky header, hero value proposition + search, one product preview (score / confidence / four dimensions / eight-run strip), rating vs Trust Factor comparison, eight-run explainer, provenance/methodology, final search CTA.
- Character profile IA centered on Trust Score: above-fold identity + score + grade + confidence + freshness + four dimensions + refresh + top signals; tabs **Overview / Highest Keys / Methodology**; expandable dimension evidence; eight selected runs with mobile cards; equipment / talents / provenance / historical panels collapsed by default.
- Fixtures enriched with Aleria eight-run selection, dimension evidence payloads, and an **Unrated (U)** character. No frontend score calculation; shared scoring/provider/DB contracts untouched (web-only optional `selectedRuns` view fields).

## Visual regression

Playwright screenshots (full page) under `apps/web/e2e/screenshots/wave4-ux/`:

| Viewport | Landing | Profile |
|---|---|---|
| mobile 390×844 | `landing-mobile.png` | `profile-mobile.png` |
| tablet 768×1024 | `landing-tablet.png` | `profile-tablet.png` |
| desktop 1280×800 | `landing-desktop.png` | `profile-desktop.png` |

## Design rationale (concise)

Modern SaaS/data first: Inter UI + JetBrains Mono data + Cinzel only on major headings. Single composition preview instead of gear/radar card clutter. Sticky chrome keeps search and profile tabs reachable. Collapsible secondary panels keep Trust Score above the fold. Unavailable metrics render as “Unavailable” / Unrated — never coerced to zero.

## Follow-ups for Agent 21 / 27

- Freeze shared `ScoringRunSelection` on the API profile DTO so live mode stops relying on web-optional `selectedRuns`.
- Replace fixture dimension `contributors` extras with dimension-agent explanation DTOs when they land.
