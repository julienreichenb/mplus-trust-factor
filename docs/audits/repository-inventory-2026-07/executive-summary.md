# Executive summary — Agent 01 repository inventory (2026-07)

**Branch tip inspected:** `7c6c407` (`origin/main`)  
**Audit commit:** see git log on `agent/01-foundation-repository-inventory`  
**No deletions performed by Agent 01.**

## Agent scope split (invariant)

| Agent | Role | May delete |
|-------|------|------------|
| **02** | Documentation canonicalization + frontend design guidance consolidation | Only clearly safe **historical doc/bootstrap clutter** after migration; **never** Utility/Survival probes or runtime code |
| **12** | Deferred deep cleanup **after** Utility work + Agent 11 calibration | Superseded probes/scripts, dead npm scripts, ZIP/orphans, fixture/export trim — only with deletion manifest |

Do not treat Agent 02 as a general cleanup agent. Do not start Agent 12 probe deletion before calibration review.

---

## Top 10 findings

1. **Production Survival tip is v1.1.1**; older v1/v1.1 stacks remain script-wired → `KEEP_RUNTIME` / `KEEP_RESEARCH` / `TEMPORARY_ACTIVE`, never `DELETE_SAFE`.
2. **Production Utility tip is v3.2 OBSERVED_CONTRIBUTION** (`utility-observed-shadow` → worker); opportunity v3–v3.2 research lanes stay until calibration → not `DELETE_SAFE`.
3. **Zero Utility/Survival probe files are `DELETE_SAFE`** (`probe-matrix.csv`).
4. **CD does not deploy `main` today** — `.github/workflows/cd.yml` push trigger is `integration/wave4.3` only (local branch; origin ref not found). Programme *intent* is main→test; that is not current behaviour.
5. **PR #1 and PR #2 are both OPEN and CONFLICTING** — do **not** merge either as-is; replace via consolidation with corrected naming and **four** public dimensions.
6. **`docs/frontend/` is already on main** while PR #1’s `doc/architecture/frontend/` is **not found** on main — dual brand docs trees.
7. **Dimension docs conflict:** bootstrap still describes Raid weight; brand landing invents six non-code axes; runtime v3+ uses four skill dims with `mythicRaid: 0`.
8. **Product naming conflict:** canonical product = **M+ Trust Factor**; **Trust Score** = published artifact; PR #1 “Trust Score as product” is outdated.
9. **`AGENTS.md` and `.cursor/rules/` are not found on main** (absence ≠ unused); Agent 02 is expected to add them.
10. **Three technical orphans** (root ZIP + two scripts) have strong unused evidence but are **deferred to Agent 12** (cautious), not default Agent 02 deletes.

---

## Exact files safe to remove during Agent 02

Only after the stated gates. Agent 02 must not delete probes or runtime.

| Path | Gate |
|------|------|
| Root bootstrap duplicates (8× `*.txt` listed in `safe-delete-list.txt` §A) | Keep `doc/bootstrap/*` as sole copy; fix pointers; human ack |
| `docs/frontend/BRAND_AND_UI_SYSTEM.md` | After content migrated to canonical frontend docs |
| `docs/frontend/LANDING_AND_PLAYER_UX.md` | Same |
| `docs/frontend/WOWHEAD_INTEGRATION.md` | Same |

**Not** Agent 02 defaults (even if `DELETE_SAFE`): `wallidrixe-wcl-performance.zip`, `tools/scripts/write-points-and-damage-fixture.mjs`, `tools/scripts/wallidrixe-reconciliation-summary.mjs` → Agent 12 / human ack.

---

## Exact files that must not be removed before Utility / calibration

Do not delete or demote until Agent 11 calibration is reviewed and Agent 12 runs a deletion manifest:

### Survival (keep)
- `packages/providers/warcraftlogs/src/probe/survival-v1_1_1-{config,logic,maxhp}.ts` (CANONICAL)
- All `KEEP_RUNTIME` survival helpers used by `analysis/` and worker (`survival-probe*`, `survival-v1_1-*`, `survival-calibration-*`, `survival-v1-logic` helpers)
- npm scripts: `wcl:probe:survival`, `wcl:probe:survival:calibration`, `wcl:probe:survival:v1`, `wcl:probe:survival:v1.1`, `wcl:probe:survival:v1.1:audit` and their `run-*.ts` entrypoints

### Utility (keep)
- `utility-v3_2-observed-{config,contribution}.ts`, `utility-observed-shadow.ts`, `utility-publication-{mode,eligibility}.ts` (CANONICAL)
- Shared evidence + opportunity engine used by production shadow path
- Entire utility v1–v3.2 opportunity research stack while scripts remain wired
- npm scripts: `wcl:probe:utility*` (all variants), `wcl:shared-evidence:load`, `recover-utility-probe-from-snapshot.mjs` (ARCHIVE ops)

### Also keep
- `packages/providers/warcraftlogs/src/evidence/*` production modules (`shared-evidence-ingest`, `*-from-shared-evidence`, `wcl-run-evidence*`)
- Any `probe-matrix.csv` row with `classification` in {CANONICAL, KEEP_RUNTIME, KEEP_RESEARCH, TEMPORARY_ACTIVE, ARCHIVE, UNKNOWN_REQUIRES_REVIEW}

---

## Decisions required from the user

1. Confirm product naming: **M+ Trust Factor** (product) + **Trust Score** (published score) for Agent 02 docs.
2. Confirm public skill dimensions = **Performance, Survival, Utility, Experience** (Authenticity separate).
3. RAID enum: keep weight-0 compatibility vs schedule hard removal.
4. Ack Agent 02 may delete root bootstrap duplicates after archive.
5. Ack Agent 12 (not 02) owns ZIP + orphan script deletion.
6. When to close PR #1/#2 after Agent 02 replacement (human `gh` action).
7. Whether to add `AGENTS.md` now (Agent 02 prompt expects yes).
8. CD policy timing (Agent 05): switch deploy trigger from `integration/wave4.3` to `main`.
9. Fate of `interrupt-catalog-coverage.ts` (promote vs un-export).
10. Worktree cleanup: which historical `mplus-agents/*` checkouts may be removed.

---

## Recommended inputs and boundaries for Agent 02

### Inputs (read first)
- This directory, especially `executive-summary.md`, `inventory.md`, `documentation-conflicts.md`, `frontend-pr-consolidation.md`, `proposed-canonical-tree.md`, `safe-delete-list.txt`, `requires-human-review.txt`
- `.cursor-orchestration/2026-07-stabilization/` standalone prompts (embedded decisions: four dimensions, freshness, boost policy)
- `AGENTS.md` and `doc/product/` after Agent 02
- Current code for v6 / active model behaviour before writing scoring docs

### In scope
- Build one canonical docs entry point (`AGENTS.md`, canonical `docs/` or adapted `doc/` tree per Agent 02 prompt + existing conventions)
- Fix all five/six-dimension and Factor/Score naming errors in active docs
- Consolidate frontend design guidance from PR #1 structure + PR #2 detail **without merging those PR branches**
- Archive bootstrap duplicates; remove only §A gated paths
- Add `.cursor/rules` pointing at canonical frontend docs

### Out of scope / forbidden
- Delete any Utility or Survival probe
- Refactor runtime, scores, weights, provider contracts, refresh behaviour
- Merge or close PR #1 / PR #2 automatically
- Claim or implement CD-from-main (Agent 05)
- Deep-clean ZIP, orphan scripts, dead `wcl:probe:*`, package export trimming (Agent 12)
- Remove worktrees

### Handoff to later agents
- Agent 05: CD trigger / deploy policy
- Agents 06–11: Utility + calibration (preserve research probes)
- Agent 12: `safe-delete-list.txt` §B + probe/script retirement with full deletion manifest
