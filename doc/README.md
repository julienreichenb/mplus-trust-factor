# Documentation index

**Canonical documentation root:** this `doc/` tree.

Start here if you are new: [product scope](product/product-scope.md) → [scoring model v6](product/scoring-model-v6.md) → [system overview](architecture/system-overview.md).

Agents: read root [`AGENTS.md`](../AGENTS.md) first.

## Map

| Area | Path | Purpose |
|------|------|---------|
| Product | [`product/`](product/) | Scope, v6 scoring, ranking/confidence/U |
| Architecture | [`architecture/`](architecture/) | System, refresh, WCL, publication, IAM, addon, frontend, [character search / realm catalog](architecture/character-search-and-realm-catalog.md), [Scoring V2 ADRs](architecture/adr/) |
| Operations | [`operations/`](operations/) | Local, test env, [release promotion](operations/release-promotion-flow.md), CI/CD, model lifecycle |
| Agents | [`agents/`](agents/) | Workflow, DoD, ownership (+ historical wave packs) |
| ADRs | [`adr/`](adr/), [`architecture/adr/`](architecture/adr/) | Architecture decision records (Scoring V2 planning ADRs under architecture/adr) |
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
| [`docs/scoring-v2/`](../docs/scoring-v2/) | Scoring V2 normative specs + implementation baseline (planning) |
| [`docs/audits/`](../docs/audits/) | Agent 01 inventory and consolidation plans |
| [`docs/README.md`](../docs/README.md) | Pointer only — product docs live in `doc/` |
| [`.cursor-orchestration/2026-07-stabilization/`](../.cursor-orchestration/2026-07-stabilization/) | Temporary programme prompts / worktree commands |
