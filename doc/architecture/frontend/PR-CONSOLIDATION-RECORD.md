# Front-end PR consolidation record

Agent 02 replacement for open design PRs. **Do not merge PR #1 or #2 as-is.**

| PR | Branch | URL |
|----|--------|-----|
| #1 | `design/mpts-brand-ui-system` | https://github.com/julienreichenb/mplus-trust-factor/pull/1 |
| #2 | `design/mpts-brand-system` | https://github.com/julienreichenb/mplus-trust-factor/pull/2 |

## Retained / authored in this change set

| Path | Source |
|------|--------|
| `doc/architecture/frontend/brand-and-ux-system.md` | PR #1 structure + PR #2 principles; naming/dimensions corrected |
| `doc/architecture/frontend/landing-and-player-ux.md` | PR #2 section depth + PR #1 concept; **four** dimensions only |
| `doc/architecture/frontend/wow-content-integration.md` | PR #1 + unique Wowhead boundaries from PR #2 |
| `doc/architecture/frontend/landing-page-concept.svg` | PR #1 |
| `doc/architecture/frontend/PR-CONSOLIDATION-RECORD.md` | This record |
| `.cursor/rules/mpts-frontend-brand.mdc` | PR #1 (paths + product naming corrected) |
| `apps/web/public/brand/mpts-mark.svg` | PR #1 |
| `apps/web/public/favicon.svg` | Kept existing `main` asset |
| `apps/web/src/design-tokens.css` | Kept existing `main` import path (not PR #1 `styles/design-tokens.css`) |

## Replaced / removed

| Former material | Disposition |
|-----------------|-------------|
| Secondary-tree brand / landing / Wowhead guidance | Removed after migration into `doc/architecture/frontend/` |
| PR #1 invented six skill axes on landing guidance | Corrected to four public dimensions only |
| PR #1 `apps/web/src/styles/design-tokens.css` | **Not** added — would duplicate tokens |

## Corrections applied vs both PRs

1. Product name = **M+ Trust Factor**; Trust Score = published metric.
2. Public skill dimensions = Performance, Survival, Utility, Experience only.
3. Single token file at the path already imported by the app.

## Close PR #1 / #2 after review (manual)

After this branch is reviewed and merged to `main`, a human should close the superseded PRs:

```bash
gh pr close 1 --comment "Superseded by canonical doc/architecture/frontend/ consolidation. Do not merge this branch."
gh pr close 2 --comment "Superseded by canonical doc/architecture/frontend/ consolidation. Do not merge this branch."
```

Agent 02 must **not** close them automatically.
