# Documentation index

**Canonical documentation root:** this `doc/` tree.

Start here if you are new: [product scope](product/product-scope.md) → [scoring model v6](product/scoring-model-v6.md) → [system overview](architecture/system-overview.md).

Agents: read root [`AGENTS.md`](../AGENTS.md) first.

## Map

| Area | Path | Purpose |
|------|------|---------|
| Product | [`product/`](product/) | Scope, v6 scoring, ranking/confidence/U |
| Architecture | [`architecture/`](architecture/) | System, refresh, parallel admission, WCL, publication, IAM, addon, frontend, [character search](architecture/character-search-and-realm-catalog.md) |
| Operations | [`operations/`](operations/) | Local, test env, [release promotion](operations/release-promotion-flow.md), CI/CD, model lifecycle, [Scoring V2 runbooks](operations/scoring-v2-runbooks.md) |
| Agents | [`agents/`](agents/) | Workflow, definition of done, ownership |
| ADRs | [`adr/`](adr/) | Architecture decision records |
| Scoring | [`scoring/`](scoring/) | Calibration, abilities, boost shadow, [V2 specs](scoring/v2/) |
| API / providers | [`api/`](api/) | Blizzard / WCL / Raider.IO provider docs |
| Research | [`research/`](research/) | Live provider behaviour and source policy |
| Testing / security | [`testing/`](testing/), [`security/`](security/) | Fixtures, threat model, red-flag language |

## Naming

- Product: **M+ Trust Factor**
- Published metric: **Trust Score**
- Short mark: **M+TS**

## Policy

Completed prompts, temporary worktree instructions, generated reports and superseded plans are deleted after their useful decisions are incorporated into canonical documentation. Git history is the archive.
