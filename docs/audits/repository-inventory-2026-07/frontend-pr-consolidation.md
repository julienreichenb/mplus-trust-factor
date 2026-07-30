# Frontend PR consolidation plan

**Do not merge or close PRs from this agent.** This document proposes the replacement work only.

## Open PRs (inspected via `gh`)

| PR | Branch | State | Mergeable | Tip (remote) |
|----|--------|-------|-----------|--------------|
| [#1](https://github.com/julienreichenb/mplus-trust-factor/pull/1) | `design/mpts-brand-ui-system` | OPEN | CONFLICTING | `5bdb5e6` |
| [#2](https://github.com/julienreichenb/mplus-trust-factor/pull/2) | `design/mpts-brand-system` | OPEN | CONFLICTING | `bfed9b4` |

Both base on `main`. Neither should merge as-is.

## File lists

### PR #1 (structural base)

- `.cursor/rules/mpts-frontend-brand.mdc`
- `apps/web/public/brand/mpts-mark.svg`
- `apps/web/public/favicon.svg`
- `apps/web/src/styles/design-tokens.css`
- `doc/architecture/frontend/brand-and-ux-system.md`
- `doc/architecture/frontend/landing-page-concept.svg`
- `doc/architecture/frontend/wow-content-integration.md`

### PR #2

- `apps/web/public/favicon.svg`
- `apps/web/src/design-tokens.css`
- `docs/frontend/BRAND_AND_UI_SYSTEM.md`
- `docs/frontend/LANDING_AND_PLAYER_UX.md`
- `docs/frontend/WOWHEAD_INTEGRATION.md`

### Already on `main` (from PR #2 lineage / later commits)

- `docs/frontend/{BRAND_AND_UI_SYSTEM,LANDING_AND_PLAYER_UX,WOWHEAD_INTEGRATION}.md`
- `apps/web/src/design-tokens.css` (imported by `apps/web/src/styles.css`; has diverged from PR #2 — extra tier-rgb/gutters)
- Favicon path exists

### Not on `main` (PR #1 only)

- `doc/architecture/frontend/**`
- `.cursor/rules/mpts-frontend-brand.mdc`
- `apps/web/public/brand/mpts-mark.svg`
- `apps/web/src/styles/design-tokens.css` (alternate path)

## Outdated facts to correct before any merge

1. **Product naming:** Prefer **M+ Trust Factor** as product; **Trust Score** for the published score. Drop PR #1 “M+ Trust Score as product name” rule that forbids Factor.
2. **Dimensions:** Public skill axes = Performance, Survival, Utility, Experience (programme + Wave4 + `createDefaultModelV3`). Remove invented axes in `LANDING_AND_PLAYER_UX.md` (Consistency/Preparedness/…). Remove any five-dimension (with Raid) or six-dimension marketing language. Authenticity is separate; do not market “five” or “six” skill dimensions.
3. **Architecture:** Blizzard source-of-truth + Wowhead progressive enhancement is still valid — keep that content.
4. **Token path:** Single file only. Prefer keeping the **already-imported** `apps/web/src/design-tokens.css` and fold PR #1 `--mpts-*` tokens into it (or move import once — never ship both).

## Proposed replacement branch

Suggested name: `design/mpts-brand-consolidation` (from current `main`).

### Retained / authored files

| Path | Source |
|------|--------|
| `doc/architecture/frontend/brand-and-ux-system.md` | PR #1 structure + corrected naming/dimensions + useful checklist detail from `docs/frontend/BRAND_AND_UI_SYSTEM.md` |
| `doc/architecture/frontend/wow-content-integration.md` | PR #1 + merge unique Wowhead boundaries from `docs/frontend/WOWHEAD_INTEGRATION.md` |
| `doc/architecture/frontend/landing-and-player-ux.md` | Merge PR #1 concept + `LANDING_AND_PLAYER_UX.md` section depth; fix dimension list |
| `doc/architecture/frontend/landing-page-concept.svg` | PR #1 |
| `.cursor/rules/mpts-frontend-brand.mdc` | PR #1 (point to `doc/architecture/frontend/`) |
| `apps/web/public/brand/mpts-mark.svg` | PR #1 |
| `apps/web/public/favicon.svg` | Keep current main / best of both SVGs after visual compare |
| `apps/web/src/design-tokens.css` | Current main + PR #1 palette tokens reconciled |

### Remove after consolidation (follow-up commit)

- `docs/frontend/*` (redirect stub or delete once `doc/architecture/frontend/` is canonical)
- Do not add `apps/web/src/styles/design-tokens.css` if merging into existing import path

### PR lifecycle

1. Open replacement PR with corrections above.
2. After merge: close #1 and #2 as superseded (human/ops action).
3. Do not merge #1 or #2 directly (`CONFLICTING` + stale product facts).
