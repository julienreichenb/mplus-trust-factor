# Known limitations — Wave 2 integration

## Providers
| Area | Limitation |
|------|------------|
| Blizzard live | Requires OAuth credentials; composite fixture covers tests |
| WCL live | `getReportFightDetails` actor resolution uses `WCL_DEFAULT_*` env in live mode |
| WCL contracts | `RunCombatFacts` types live in provider package (CR-02 deferred) |
| Raider.IO live | Season-cutoffs endpoint returned HTTP 500 during Agent 3 verification |
| Raider.IO legal | Commercial/competing use requires Raider.IO contact before launch |
| Raider.IO cache | In-memory only; Postgres/Redis persistence deferred |

## Product
| Area | Limitation |
|------|------------|
| Frontend | Vue pages are stubs; live API wiring incomplete |
| E2E | Playwright cohort flow not automated in this integration |
| Boost detection | Probabilistic wording only; no dispute mechanism |
| Hidden logs | Reduce confidence via visibility state; do not force zero score |

## Engineering
| Area | Limitation |
|------|------------|
| Addon eligibility | DB export uses snapshot rows; eligibility rules may exclude low-run characters |
| Data quality | `validateScoreSnapshot` warns on violation; does not block persistence |
| M+ zone ID | WCL discovery uses MVP static zone default |
