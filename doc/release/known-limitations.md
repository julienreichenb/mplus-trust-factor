# Known limitations — Wave 2 integration

## Providers
| Area | Limitation |
|------|------------|
| Blizzard live | Requires OAuth credentials; composite fixture covers tests |
| WCL live | Actor resolution uses refresh identity via `ProviderFetchContext.targetCharacter`; `WCL_DEFAULT_*` only for smoke tooling |
| WCL contracts | `RunCombatFacts` types live in provider package (CR-02 deferred) |
| Raider.IO live | Season-cutoffs endpoint returned HTTP 500 during Agent 3 verification |
| Raider.IO legal | Commercial/competing use requires Raider.IO contact before launch |
| Raider.IO cache | In-memory only; Postgres/Redis persistence deferred |

## Product
| Area | Limitation |
|------|------------|
| Frontend | Vue SPA restored; `VITE_API_MODE=live` works against fixture API in E2E |
| E2E | Playwright mock smoke + fixture pipeline E2E; Postgres `:5433` required; global setup always cold-starts servers (no reuse) |
| Compare | Minimum 2 candidates enforced on submit only, not on add |
| WCL visibility | PUBLIC state uses sr-only marker; warning banner only for non-PUBLIC |
| Boost detection | Probabilistic wording only; no dispute mechanism |
| Hidden logs | Reduce confidence via visibility state; do not force zero score |

## Engineering
| Area | Limitation |
|------|------------|
| E2E builds | Mock and fixture-live use separate `dist-mock` / `dist-e2e-live` dirs |
| E2E startup | Full cold start runs two Vite builds (~30s) before tests |
| Addon eligibility | DB export uses snapshot rows; eligibility rules may exclude low-run characters |
| Data quality | `validateScoreSnapshot` warns on violation; does not block persistence |
| M+ zone ID | WCL discovery uses MVP static zone default |
