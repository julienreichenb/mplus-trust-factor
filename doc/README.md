# Documentation index

**Canonical documentation root:** this `doc/` tree.

Start here if you are new: [product scope](product/product-scope.md) → [scoring model v6](product/scoring-model-v6.md) → [system overview](architecture/system-overview.md).

Agents: read root [`AGENTS.md`](../AGENTS.md) first.

## Map

| Area | Path | Purpose |
|------|------|---------|
| Product | [`product/`](product/) | Scope, v6 scoring, ranking/confidence/U |
| Architecture | [`architecture/`](architecture/) | System, refresh, WCL, publication, IAM, addon, frontend |
| Operations | [`operations/`](operations/) | Local, test env, [release promotion](operations/release-promotion-flow.md), CI/CD, model lifecycle |
| Agents | [`agents/`](agents/) | Workflow, DoD, ownership (+ historical wave packs) |
| ADRs | [`adr/`](adr/) | Architecture decision records |
| Archive | [`archive/`](archive/) | Superseded prompts and bootstrap notes |
| Scoring notes | [`scoring/`](scoring/) | Package-oriented scoring pointers |
| API / providers | [`api/`](api/) | Blizzard / WCL / Raider.IO provider docs |
| Testing / security | [`testing/`](testing/), [`security/`](security/) | Fixtures, threat model, red-flag language |
| Plans / research | [`plans/`](plans/), [`research/`](research/) | Historical plans and live-API research |
| Bootstrap (archive) | [`bootstrap/`](bootstrap/) | Wave-1 starter pack (historical; not current product truth) |

## Naming

- Product: **M+ Trust Factor**
- Published metric: **Trust Score**
- Short mark: **M+TS**

## Related trees

| Path | Role |
|------|------|
| [`docs/audits/`](../docs/audits/) | Agent 01 inventory and consolidation plans |
| [`docs/README.md`](../docs/README.md) | Pointer only — product docs live in `doc/` |
| [`.cursor-orchestration/2026-07-stabilization/`](../.cursor-orchestration/2026-07-stabilization/) | Temporary programme prompts / worktree commands |
