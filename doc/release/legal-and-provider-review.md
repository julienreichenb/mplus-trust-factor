# Legal and provider review

## Raider.IO — action required before commercial launch

Raider.IO publishes acceptable-use and commercial restrictions. Before any broad public or competing commercial launch:

1. Review current Raider.IO API / data terms.
2. Contact Raider.IO for explicit permission if the product competes with or substantially replicates their offering.
3. Maintain attribution when `raiderIoUsed` is true in the UI.

**Current MVP:** fixture-only Raider.IO adapter; no live bulk usage.

## Blizzard

- Use Battle.net API per developer portal terms.
- Do not expose `BLIZZARD_CLIENT_SECRET` in client bundles or logs.
- Respect profile freshness and anti-crawl guidance for leaderboards.

## Warcraft Logs

- Public API subject to rate limits and terms of service.
- Hidden logs reduce confidence; do not claim access to private data.

## Boost / red-flag wording

- All boost suspicion outputs are **probabilistic evidence**, not accusations.
- A future dispute mechanism is not implemented in MVP.
