# Agent 20 — Wave 3 final integration handoff

Branch: `integration/wave3`

## Merge readiness

**GO** to merge `integration/wave3` into `main` (fast-forward; `main` is an ancestor).

Default branch on GitHub is **`main`** (not `master`).

## Agent 20 changes

- `pnpm build` now runs `clean:dist` first (fixes TypeScript incremental skip-emit after wiping `dist/`)
- Documented `WCL_MPLUS_ZONE_EXPIRES_AT` in `.env.example` + expanded `doc/operations/wave3.md` (rollback, clean build, migrations)
- Updated Wave 3 known limitations
- Lint cleanups (unused helpers / type imports)
- Integration test expects model **v2 ACTIVE** / **v1 ARCHIVED**

## Confirmed unchanged

- Scoring formulas, weights, fusion semantics
- Approved UI/UX layout

## Recommended merge

```bash
git checkout main
git pull origin main
git merge --ff-only integration/wave3
git push origin main
```

## Rollback

See `doc/operations/wave3.md` § Rollback procedure.
