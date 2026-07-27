# Blizzard limitations

- Profile documents update after character logout — not real-time.
- Official developer portal pages are JS SPAs; schemas confirmed from bootstrap templates + community namespace guidance on 2026-07-27. Re-validate with live smoke when credentials exist.
- Connected-realm mythic leaderboards only expose a limited top set; insufficient for population discovery. Method is explicit and must not be bulk-crawled.
- Account-wide character lists require authorization-code OAuth — out of scope for Agent 01.
- Blizzard M+ `best_runs` may be incomplete vs Raider.IO season history; treat as partial.
- `getMythicKeystoneSeasonIndex` / dungeon index return lightweight index rows without cascading into every detail fetch (avoids accidental bulk).
- No Armory HTML scraping.
- No Trust Factor scoring in this package.
