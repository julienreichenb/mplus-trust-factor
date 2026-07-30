# Documentation conflicts

Evidence from tip `7c6c407`. Runtime code wins over docs when they disagree.

## 1. Documentation roots

| Source | Claims | Conflict |
|--------|--------|----------|
| `README.md` | Start at `doc/` | Never mentions `docs/` |
| `docs/frontend/*` | Brand/UX on main | Parallel to planned `doc/architecture/frontend/` (PR #1; **not found** on main) |
| `doc/architecture/parallel-ownership.md` | Lists `doc/architecture/frontend/**` | Path absent on main |
| Root `*.txt` bootstrap | “Canonical copies also remain at repository root” (`doc/bootstrap/README.md`) | 8 root files are **byte-identical** to `doc/bootstrap/*` — duplication without drift |
| `README-FIRST.txt` | Empty-repo Agents 0→10 starter pack | Contradicts mature monorepo `README.md` |

**Resolution:** Keep `doc/` as sole public docs root. Move consolidated frontend brand docs under `doc/architecture/frontend/`. Treat root bootstrap `*.txt` as `ARCHIVE` copies of `doc/bootstrap/`.

## 2. Product naming

| Name | Where | Verdict |
|------|-------|---------|
| **M+ Trust Factor** | `README.md`, `package.json`, most runtime | `CANONICAL` product name |
| **Trust Score** | Wave4 UX, refresh policy, profile UI | Correct for the **published score artifact**, not the product |
| **M+TS** | Brand docs (both PRs) | Acceptable shorthand |
| **M+ Trust Score** as product | PR #1 brand doc | Outdated / conflicting — do not replace Factor |
| **MPTS** | Occasional | Avoid; prefer M+TS or full name |

Programme decision: product = Trust Factor; published metric = Trust Score (freshness policy). Brand docs must stop treating Factor and Score as interchangeable product names.

## 3. Dimension counts

| Claim | Evidence | Status |
|-------|----------|--------|
| 5 skill dims including Raid (5% weight) | `COMMON-CONTEXT.txt` ~104–119; early `createDefaultModel` weights | `ARCHIVE` bootstrap; superseded |
| 6 contract enums | `packages/contracts/src/scoring.ts:3-9` — PERFORMANCE, SURVIVAL, UTILITY, EXPERIENCE, RAID, AUTHENTICITY | Schema reality; RAID may remain for compatibility |
| 4 public skill dims; Raid removed | `doc/agents/wave4/README_WAVE4.md:14-28`; `createDefaultModelV3` `mythicRaid: 0` (`packages/scoring/src/model/defaults.ts:165-180`) | `CANONICAL` public model |
| “maximum 6” radar | `docs/frontend/BRAND_AND_UI_SYSTEM.md:156` | Cap language OK; must map to real axes |
| Invented six: Experience/Performance/Consistency/Preparedness/Progression relevance/Evidence quality | `docs/frontend/LANDING_AND_PLAYER_UX.md:184-191` | **Wrong** — does not match code or Wave4 |
| PR #1 “six dimensions / six fixed axes” | PR #1 brand doc (branch only) | Outdated vs programme **four** public skill dimensions |

**Canonical public surface (programme):** Performance, Survival, Utility, Experience. Authenticity/boost is separate. Confidence/uncertainty is presentation, not a sixth skill dimension.

## 4. Agent prompt dual trees

| Tree | Role |
|------|------|
| `agents/*.txt` | Wave-1 starter prompts (pre-implementation) |
| `doc/agents/*.md` | Handoffs for early agents (incomplete set vs `agents/`) |
| `doc/agents/wave3|wave4|wave4-bis/**` | Later wave packs still referenced by open worktrees |

Incomplete mapping: `agents/01,04,05,06,08-*.txt` lack matching top-level `doc/agents/0N-*.md`.

## 5. CI / CD vs programme git policy

| File | Current | Programme decision |
|------|---------|-------------------|
| `.github/workflows/ci.yml` | `main` + `integration/**` + `agent/**` | OK for CI |
| `.github/workflows/cd.yml:28-30` | Push deploy from **`integration/wave4.3` only** | Should deploy test from **`main`** |
| `doc/operations/production.md` | Still documents wave4.3-era refs | Stale |

## 6. Missing expected agent entrypoints

| Expected | On main |
|----------|---------|
| `AGENTS.md` | **not found** |
| `.cursor/rules/**` | **not found** (only on PR #1) |

Stabilization context lives under `.cursor-orchestration/` (temporary prompts with embedded decisions). Long-term agent entry is `AGENTS.md` + `doc/`.

## 7. Fixture / artifact docs

- `doc/testing/fixtures.md` documents dual fixture trees — keep both until a dedicated fixture cleanup.
- Many probe docs reference gitignored `raw-artifacts/` — distinguish local dumps (**not in git**) from tracked fixtures.
- Root `wallidrixe-wcl-performance.zip` is tracked but undocumented and unreferenced.
