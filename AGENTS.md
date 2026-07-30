# AGENTS.md — M+ Trust Factor

Entry point for humans and coding agents working in this repository.

## Read first (≤ 1 minute)

1. **Canonical docs index:** [`doc/README.md`](doc/README.md)
2. **Product scope:** [`doc/product/product-scope.md`](doc/product/product-scope.md)
3. **Agent workflow:** [`doc/agents/workflow.md`](doc/agents/workflow.md)
4. **Definition of done:** [`doc/agents/definition-of-done.md`](doc/agents/definition-of-done.md)
5. **File ownership:** [`doc/agents/file-ownership-map.md`](doc/agents/file-ownership-map.md)

Temporary programme prompts and worktree commands live under [`.cursor-orchestration/2026-07-stabilization/`](.cursor-orchestration/2026-07-stabilization/). Use your assigned standalone prompt there; do not invent a parallel context tree.

## Canonical facts (do not contradict)

| Topic | Canonical doc |
|-------|----------------|
| Product name | **M+ Trust Factor** (product); **Trust Score** (published metric); short **M+TS** |
| Public skill dimensions | Performance, Survival, Utility, Experience — see [`doc/product/scoring-model-v6.md`](doc/product/scoring-model-v6.md) |
| Confidence / grade U | [`doc/product/ranking-confidence-and-missing-data.md`](doc/product/ranking-confidence-and-missing-data.md) |
| Refresh / freshness | [`doc/architecture/refresh-lifecycle.md`](doc/architecture/refresh-lifecycle.md) |
| Model activation | [`doc/operations/model-lifecycle.md`](doc/operations/model-lifecycle.md) — DB/admin, not env flips |
| Front-end brand/UX | [`doc/architecture/frontend/`](doc/architecture/frontend/) |
| Local / CI / test deploy | [`doc/operations/`](doc/operations/) |

## Code wins over docs

If a document disagrees with runtime code, **code is authority**. Update the doc or open a follow-up; do not silently invent a fifth/sixth public skill dimension or treat env var edits as normal model activation.

## Stabilization programme

Prompts and worktree commands: [`.cursor-orchestration/2026-07-stabilization/`](.cursor-orchestration/2026-07-stabilization/).
Inventory audit: [`docs/audits/repository-inventory-2026-07/`](docs/audits/repository-inventory-2026-07/).

## Forbidden without an explicit prompt

- Delete Utility/Survival research probes.
- Change score formula, weights or thresholds.
- Change provider contracts or refresh behaviour.
- Merge or force-close design PR #1 / #2 without the replacement review path in [`doc/architecture/frontend/PR-CONSOLIDATION-RECORD.md`](doc/architecture/frontend/PR-CONSOLIDATION-RECORD.md).
