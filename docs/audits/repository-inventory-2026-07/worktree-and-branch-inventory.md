# Worktree and branch inventory

Snapshot: local machine, tip of this worktree = `7c6c407` = `origin/main`.

Evidence: `git worktree list --porcelain`, `git branch -a`, `gh pr list`, `git rev-parse` on integration refs.

## Active stabilization worktrees

| Worktree | Branch | HEAD | Notes |
|----------|--------|------|-------|
| `…/mplus-trust-factor` | `main` | `7c6c407` | Primary main checkout |
| `…/mplus-worktrees/00-foundation-ci-repair` | `agent/00-foundation-ci-repair` | `7c6c407` | Same tip as main (CI repair agent) |
| `…/mplus-worktrees/01-foundation-repository-inventory` | `agent/01-foundation-repository-inventory` | `7c6c407` | **This agent** |

## Open design remotes / PRs

| Ref | Tip | PR |
|-----|-----|-----|
| `origin/design/mpts-brand-ui-system` | `5bdb5e6` | #1 CONFLICTING |
| `origin/design/mpts-brand-system` | `bfed9b4` | #2 CONFLICTING |
| `origin/feature/account-character-discovery` | (tracked) | related worktree below |
| `origin/agent/wave4-final-integration` | remote present | historical |
| `origin/agent/wave4.5-wcl-utility-probe` | remote present | historical |
| `origin/integration/wave3` | `544baa21` | stale wave integrate |
| `origin/integration/wave4` | `a05ba4ca` | stale wave integrate |

## Integration branches (stale vs programme)

Programme **intent**: feature → PR → `main`; `main` deploys test.  
**Current CD reality:** push deploy listens to `integration/wave4.3` only — it does **not** deploy `main` automatically today.

| Branch | Local SHA | Remote | Verdict |
|--------|-----------|--------|---------|
| `integration/wave4.3` | `7f4f0cd2` | **not found** on origin | Stale; still referenced by `.github/workflows/cd.yml` push trigger |
| `integration/wave4.2` | `6aa75363` | not found | Local-only archive |
| `integration/wave4.1` | `9cc631eb` | not found | Local-only archive |
| `integration/wave4` | `a05ba4ca` | matches origin | Historical |
| `integration/wave3` | `544baa21` | matches origin | Historical |
| `integration/wave2` | local | — | Historical |
| `integration/wave1` | local | — | Historical |

**CD mismatch:** push deploy listens to `integration/wave4.3`, which is not on origin — deploy-on-push from that branch is effectively dead unless force-pushed locally to a remote of that name.

## Wave 4.3 / 4.4 agent worktrees (likely still valuable)

| Worktree | Branch | HEAD |
|----------|--------|------|
| `…/34-wcl-survival-probe` | `agent/wave4.4-wcl-survival-probe` | `add8494c` |
| `…/35-wcl-utility-probe` | `agent/wave4.3-utility-shadow` | `44eaf27d` |
| `…/37-experience-rework` | `agent/wave4.3-experience` | `55f3fb7e` |
| `…/38-battlenet-iam` | `agent/wave4.3-battlenet-iam` | `49aeaffe` |
| `…/39-refresh-orchestration` | `agent/wave4.3-refresh-orchestration` | `18539a0b` |
| `…/40-cicd-vps` | `agent/wave4.3-cicd-vps` | `6e70eff5` |
| `…/mplus-trust-factor-account-characters` | `feature/account-character-discovery` | `a838cafc` |

Also local (no dedicated worktree listed for all): `agent/wave4.5-wcl-utility-probe`, `agent/wave4.6-persistence-refresh-hardening`, `backup/wave3-before-uiux`.

## Historical agent worktrees (waves 1–4.2)

These checkouts predate current `main` tip. Treat as **ARCHIVE** worktrees unless a unique unmerged commit is needed. Prefer `git log main..<branch>` before removal.

| Worktree | Branch | HEAD |
|----------|--------|------|
| `…/mplus-agents/01-blizzard` | `agent/blizzard` | `eefe8fbc` |
| `…/mplus-agents/02-warcraftlogs` | `agent/warcraftlogs` | `b4404da0` |
| `…/mplus-agents/03-raiderio` | `agent/raiderio` | `b600402a` |
| `…/mplus-agents/04-scoring` | `agent/scoring` | `ad68e509` |
| `…/mplus-agents/05-backend` | `agent/backend` | `347cb719` |
| `…/mplus-agents/06-frontend` | `agent/frontend` | `26688061` |
| `…/mplus-agents/07-addon` | `agent/addon` | `70c390c1` |
| `…/mplus-agents/08-devops` | `agent/devops` | `299d8cfa` |
| `…/mplus-agents/09-qa` | `agent/qa` | `256c59a2` |
| `…/mplus-agents/11-live-foundation` | `agent/w3-live-foundation` | `43356373` |
| `…/mplus-agents/12-blizzard-live` | `agent/wave3-blizzard` | `069566c9` |
| `…/mplus-agents/13-raiderio-live` | `agent/wave3-raiderio` | `4665bc0a` |
| `…/mplus-agents/14-warcraftlogs-live` | `agent/wave3-warcraftlogs` | `385eae6d` |
| `…/mplus-agents/15-live-fusion` | `agent/wave3-live-fusion` | `62023cc9` |
| `…/mplus-agents/21-wave4-foundation` | `agent/wave4-data-foundation` | `6163108c` |
| `…/mplus-agents/22-performance-v3` | `agent/wave4-performance-v3` | `25fbf6db` |
| `…/mplus-agents/23-survival-v3` | `agent/wave4-survival-v3` | `a927cacc` |
| `…/mplus-agents/24-utility-v3` | `agent/wave4-utility-v3` | `03b35aba` |
| `…/mplus-agents/25-experience-v3` | `agent/wave4-experience-v3` | `0f45417e` |
| `…/mplus-agents/26-wave4-ux` | `agent/wave4-ux` | `a595be7e` |
| `…/mplus-agents/27-wave4-integration` | `agent/wave4-final-integration` | `e7c3e985` |
| `…/mplus-agents/28-wave4-search-ui` | `agent/wave4.1-search-ui` | `9faf453f` |
| `…/mplus-agents/29-wave4-scoring-audit` | `agent/wave4.1-scoring-audit` | `0f7af54` |
| `…/mplus-agents/30-wave4-search-ingestion` | `agent/wave4.2-search-ingestion` | `1fd579ed` |
| `…/mplus-agents/31-wave4-scoring-finalizer` | `agent/wave4.2-scoring-finalizer` | `dc536043` |
| `…/mplus-agents/32-wave4-ability-catalog` | `agent/wave4.2-ability-catalog` | `bccac84e` |
| `…/mplus-agents/33-wcl-performance` | `agent/wave4.3-wcl-performance` | `35a03acc` |
| `…/mplus-agents/uiux-frontend` | `uiux-frontend` | `689bc2d5` |

## Counts

- Local worktrees observed: **38**
- Open PRs: **2** (both design, both conflicting)
- This agent: no merge, no worktree removal

## Suggested hygiene (human)

1. Fix CD to `main` before relying on integration branches.
2. After confirming merges, `git worktree remove` historical `mplus-agents/*` checkouts.
3. Keep wave4.3–4.4 and account-discovery worktrees until their PRs land or are abandoned.
4. Close design PRs only after consolidation replacement merges.
