# Repository inventory — 2026-07

**Agent:** 01 Foundation Repository Inventory  
**Branch:** `agent/01-foundation-repository-inventory`  
**Worktree:** `C:/Users/julie/VS Projects/mplus-worktrees/01-foundation-repository-inventory`  
**Inspected tip:** `7c6c407cff5cb9d63253f9746cae68c78fcdbd11` (matches `origin/main`)  
**Method:** code/import/script/git evidence only. No deletions performed.

Companion artifacts in this directory:

| File | Purpose |
|------|---------|
| `executive-summary.md` | Top findings, Agent 02/12 boundaries, user decisions |
| `probe-matrix.csv` | WCL probe + evidence classification matrix |
| `documentation-conflicts.md` | Naming, dimensions, doc tree conflicts |
| `frontend-pr-consolidation.md` | PR #1 / #2 consolidation plan (do not merge as-is) |
| `proposed-canonical-tree.md` | Target layout for docs/agents/scripts |
| `safe-delete-list.txt` | Strong-evidence delete candidates (scoped by agent) |
| `requires-human-review.txt` | Ambiguous / policy decisions |
| `worktree-and-branch-inventory.md` | Local worktrees, branches, stale integration refs |

### Agent 02 vs Agent 12

| Agent | Work | Deletion authority |
|-------|------|--------------------|
| **02** docs canonicalization | Canonical docs, naming/dimension fixes, frontend guidance consolidation | Doc/bootstrap clutter in `safe-delete-list.txt` §A only, after gates |
| **12** deep clean (after Utility + Agent 11 calibration) | Probe/script/ZIP retirement, dead npm scripts, fixture/export trim | `safe-delete-list.txt` §B + superseded research probes with deletion manifest |

Agent 02 must **not** delete Utility/Survival probes. Agent 12 must **not** start probe deletion before calibration review.

---

## Classification legend

| Class | Meaning |
|-------|---------|
| `CANONICAL` | Current product/runtime source of truth |
| `KEEP_RUNTIME` | Required by production or fixture path |
| `KEEP_RESEARCH` | Scientific lineage still useful; not public tip |
| `TEMPORARY_ACTIVE` | Wired npm/CLI probes; keep while calibration runs |
| `ARCHIVE` | Superseded; retain until cleanup PR retires refs |
| `DELETE_SAFE` | Strong unused evidence; safe after review |
| `UNKNOWN_REQUIRES_REVIEW` | Exists but role unclear |

---

## Top-level layout

| Path | Classification | Evidence |
|------|----------------|----------|
| `README.md` | `CANONICAL` | Live monorepo quickstart; points to `doc/` |
| `README-FIRST.txt` + other root `*.txt` bootstrap pack | `ARCHIVE` | Byte-identical to `doc/bootstrap/*`; describes empty-repo agent wave, not current main |
| `doc/` | `CANONICAL` | Declared documentation root in `README.md` |
| `docs/frontend/` | `TEMPORARY_ACTIVE` | Brand docs already on main (PR #2 lineage); conflicts with PR #1 `doc/architecture/frontend/` plan |
| `docs/audits/` | `TEMPORARY_ACTIVE` | This audit |
| `agents/*.txt` | `ARCHIVE` | Wave-1 starter prompts; handoffs live under `doc/agents/**` |
| `doc/agents/wave3|wave4|wave4-bis/**` | `KEEP_RESEARCH` / historical | Wave execution packs; some still referenced by open worktrees |
| `.cursor-orchestration/` | `KEEP_RESEARCH` / programme | Stabilization programme prompts (temporary; decisions embedded in standalone prompts) |
| `.cursor/rules/` | **not found** on main | Present only on PR #1 branch |
| `AGENTS.md` | **not found** | Prompt expected it; absent on main |
| `apps/{api,web,worker}` | `CANONICAL` | Runtime |
| `packages/**` | `CANONICAL` | Domain packages |
| `tools/scripts/**` | Mixed | See script section + `probe-matrix.csv` |
| `tools/fixtures/**` | `KEEP_RUNTIME` | Dual layout (`flat` + `providers/*/v1`) documented in `doc/testing/fixtures.md` |
| `wallidrixe-wcl-performance.zip` | `DELETE_SAFE` (defer Agent 12) | No prod/test/package-script refs; replaced by fixtures; cautious — not Agent 02 default |
| `addon/` | `KEEP_RUNTIME` | Retail addon package |
| `infra/` | `CANONICAL` | Docker/deploy/Caddy |
| `.github/workflows/ci.yml` | `CANONICAL` | Triggers on `main`, `integration/**`, `agent/**` |
| `.github/workflows/cd.yml` | `TEMPORARY_ACTIVE` / stale policy | **Current CD does not deploy `main`.** Push trigger is `integration/wave4.3` only. Programme *intent* is main→test (Agent 05). |

---

## Product model (runtime vs docs)

| Claim | Runtime evidence | Doc conflict |
|-------|------------------|--------------|
| Product name | `README.md`, `package.json` → **M+ Trust Factor** | PR #1 prefers **M+ Trust Score**; Wave4 UX mixes both |
| Public skill dimensions | Wave4 + `createDefaultModelV3`: Perf/Surv/Util/Exp; `mythicRaid: 0` | Bootstrap `COMMON-CONTEXT.txt` still lists Raid 5%; brand docs invent alternate six-axis sets |
| Contract enums | `packages/contracts/src/scoring.ts` still has `RAID` + `AUTHENTICITY` | Correct as schema; RAID weight 0 in v3+ |

Programme decision (stabilization prompts / `doc/product/`): **four** public dimensions — Performance, Survival, Utility, Experience. Authenticity/boost is separate. Align docs/UI to that.

---

## WCL probe / evidence summary

Production tip (worker refresh path):

- Survival: `SURVIVAL_STANDALONE_V1_1_1_CONFIG` + analysis under `packages/providers/warcraftlogs/src/analysis/`
- Utility: `utility-v3_2-observed-contribution` → `utility-observed-shadow` → `apps/worker/src/orchestration/utility-shadow-refresh.ts` / `refresh-pipeline.ts`
- Shared evidence: `evidence/shared-evidence-ingest.ts`, `utility-from-shared-evidence.ts`, `survival-from-shared-evidence.ts`

Older utility v1–v3.2-opportunity and survival v1/v1.1 stacks remain **script-wired** (`package.json` `wcl:probe:*`) → `TEMPORARY_ACTIVE` / `KEEP_RESEARCH`, **not** `DELETE_SAFE`.

Full per-file matrix: `probe-matrix.csv`.

---

## Scripts inventory

### Wired in root `package.json` (KEEP)

Live smokes, WCL probes (performance/survival/utility lineage), shared-evidence load, addon, db, ops, iam grant, test suites.

### Not in `package.json` but referenced elsewhere

| Script | Status | Evidence |
|--------|--------|----------|
| `live-smoke-lib.mjs` | `KEEP_RUNTIME` | Imported by live-smoke + probe scripts; also `tests/security/secret-scanning.test.ts` |
| `sync-realm-catalog.mjs` | `KEEP_RUNTIME` | Invoked via worker `realms:sync` / `pnpm realms:sync` |

### Orphans (no package.json; no or weak refs)

| Script | Classification | Notes |
|--------|----------------|-------|
| `write-points-and-damage-fixture.mjs` | `DELETE_SAFE` (defer Agent 12) | No prod/test/package-script refs; fixtures already exist |
| `wallidrixe-reconciliation-summary.mjs` | `DELETE_SAFE` (defer Agent 12) | No prod/test/package-script refs; one-shot DB dump |
| `concurrency-hardening-test.mjs` | `ARCHIVE` | Manual QA; document or wire if kept |
| `recover-utility-probe-from-snapshot.mjs` | `ARCHIVE` | Ops recovery for probe resume |

---

## Front-end design PRs

Open, both `CONFLICTING` vs main:

- [#1](https://github.com/julienreichenb/mplus-trust-factor/pull/1) `design/mpts-brand-ui-system` — structural base (`doc/architecture/frontend/`, cursor rule, mark SVG, `styles/design-tokens.css`)
- [#2](https://github.com/julienreichenb/mplus-trust-factor/pull/2) `design/mpts-brand-system` — docs already largely on main under `docs/frontend/`; tokens path diverged

Do **not** merge either as-is. See `frontend-pr-consolidation.md`.

---

## Worktrees / branches

**38 local worktrees** observed (waves 1–4.x agent checkouts + stabilization 00/01). Most historical `agent/wave*` / `agent/blizzard` etc. are stale relative to `main` at `7c6c407`. CD still keyed to local-only `integration/wave4.3`. Details: `worktree-and-branch-inventory.md`.

---

## Recommended cleanup order (later agents; not this PR)

### Agent 02 (canonicalization — after 00/01 on main)
1. Canonical docs entry + fix Factor/Score and four-dimension facts.
2. Frontend consolidation replacement (do not merge PR #1/#2 as-is); close them after human review.
3. Archive root bootstrap duplicates; remove only `safe-delete-list.txt` §A gated paths.

### Agent 05 (parallel/later)
4. Change CD so test deploy tracks `main` (today it does **not**).

### Agent 12 (deep clean — after Utility + Agent 11 calibration)
5. Retire ZIP + orphan scripts (`safe-delete-list.txt` §B) with human ack.
6. Demote superseded `wcl:probe:*` / research exports only with deletion manifest; never while TEMPORARY_ACTIVE for calibration.
