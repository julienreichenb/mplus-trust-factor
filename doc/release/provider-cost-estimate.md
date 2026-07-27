# Provider cost estimate (fixture MVP)

| Provider | Fixture mode | Live smoke (bounded) | Production note |
|----------|--------------|----------------------|-----------------|
| Blizzard | 0 requests | ~3–5 calls per character refresh | OAuth token + profile/equipment/M+ index per refresh |
| Warcraft Logs | 0 requests | ~2 calls (rate limit + 1 summary) | GraphQL budget-sensitive; detailed fights costly |
| Raider.IO | 0 requests | ~2 calls (profile + cutoff) | Soft RPM 60 default; commercial terms apply |

**MVP default:** `PROVIDER_MODE=fixture` — zero external API cost for development and CI.

**Live refresh (single character):** order of ~10–20 provider calls depending on run analysis depth. Do not bulk-crawl.
