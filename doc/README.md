# Documentation index

**Canonical documentation root:** this `doc/` tree.

Start here if you are new: [product scope](product/product-scope.md) â†’ [scoring model v6](product/scoring-model-v6.md) â†’ [system overview](architecture/system-overview.md).

Agents: read root [`AGENTS.md`](../AGENTS.md) first.

## Map

| Area | Path | Purpose |
|------|------|---------|
| Product | [`product/`](product/) | Scope, v6 scoring, ranking/confidence/U |
| Architecture | [`architecture/`](architecture/) | System, refresh, parallel admission, WCL, publication, IAM, addon, frontend, [character search](architecture/character-search-and-realm-catalog.md), [Scoring](../scoring/SCORING_ARCHITECTURE.md) |
| Operations | [`operations/`](operations/) | Local, test env, [release promotion](operations/release-promotion-flow.md), [provider-data sharing](operations/provider-data-sharing.md), CI/CD, model lifecycle |
| Agents | [`agents/`](agents/) | Workflow, definition of done, ownership |
| ADRs | [`adr/`](adr/) | Architecture decision records |
| Scoring | [`scoring/`](scoring/) | Architecture, WCL acquisition, dimensions, operations ([canonical set](scoring/README.md)) |

| API / providers | [`api/`](api/) | Blizzard / WCL / Raider.IO provider docs |
| Research | [`research/`](research/) | Live provider behaviour and source policy |
| Testing / security | [`testing/`](testing/), [`security/`](security/) | Fixtures, threat model, red-flag language |

## Naming

- Product: **M+ Trust Factor**
- Published metric: **Trust Score**
- Short mark: **M+TS**

## Policy

Completed prompts, temporary worktree instructions, generated reports and superseded plans are deleted after their useful decisions are incorporated into canonical documentation. Git history is the archive.
