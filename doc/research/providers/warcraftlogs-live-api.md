# Warcraft Logs API — Wave 3 public-data integration notes

**Research date:** 2026-07-27  
**Status:** implementation guidance, not legal advice.

## Authentication model

For this MVP, use OAuth client credentials and the public GraphQL endpoint:

```text
POST https://www.warcraftlogs.com/oauth/token
POST https://www.warcraftlogs.com/api/v2/client
```

The `/api/v2/client` endpoint exposes public data. Do not implement user authorization or `/api/v2/user` in Wave 3. Keep the client secret server-side.

## Character resolution

Resolve an exact character with GraphQL using:

```text
characterData.character(name, serverSlug, serverRegion)
```

Map application regions to WCL region values explicitly. Preserve the target character in `ProviderFetchContext`; do not fall back to default environment identity during a normal refresh.

## Public evidence flow

Use a bounded sequence:

1. resolve character and public/hidden state;
2. retrieve current Mythic+ zone rankings when a valid current zone ID is known;
3. retrieve a bounded page of recent public reports;
4. build candidate runs;
5. analyze at most the selected latest/highest credible run(s);
6. fetch report fights/master data;
7. resolve the target actor;
8. page only the required event types and produce normalized combat facts.

Relevant GraphQL surfaces include:

- Character `recentReports(limit, page)`; documented maximum limit is 100.
- Character hidden/public state and server identity.
- Report fights, master data/actors, player details and events.
- `rateLimitData` with hourly allowance, points spent and reset time.

## Privacy and visibility

- Never discover or display private reports.
- Do not set `allowUnlisted: true` in generic report lookup. Unlisted codes must not be probed or exposed.
- Public client credentials do not authorize access to private reports.
- Archived report detail can be unavailable without archive access; classify this as unavailable evidence, not player fault.
- Combat logs exist only when someone records and uploads them. No public logs, hidden logs or partial events must lower WCL coverage/confidence only; they must not directly reduce the player’s performance score.

Recommended visibility states:

```text
PUBLIC
HIDDEN
NO_PUBLIC_LOGS
PRIVATE_SKIPPED
UNAVAILABLE
RATE_LIMITED
```

## Rate/cost controls

GraphQL operations consume points. Query `rateLimitData` and enforce:

- warning threshold,
- defer-expensive-work threshold,
- hard stop threshold,
- reset-aware retry scheduling.

Detailed event queries must be paginated and bounded by:

- maximum reports per refresh,
- maximum fights analyzed,
- required event types only,
- maximum pages/events,
- per-character TTL,
- report revision cache.

Do not run live WCL calls in CI.

## Current-season discovery

The existing provider uses a static `DEFAULT_MPLUS_ZONE_ID`. Replace this with a versioned, dynamically resolved current Mythic+ zone configuration. If dynamic discovery is not reliable, require an explicit environment/config value with validation, documentation and an expiry alarm; do not silently use an old zone.

## Run matching quality

The current candidate mapping contains optimistic placeholders (`seasonSlug: current`, `timed: true`, missing timer, possibly unknown dungeon, target-only roster). Before scoring combat facts:

- match WCL fights to Blizzard/Raider.IO runs using region, dungeon/map, key level, completion timestamp, duration and roster where available;
- compute a match confidence;
- do not attach combat facts below a documented threshold;
- persist ambiguity warnings;
- never claim a run was timed without source evidence.

## Reliability requirements

- OAuth token cache and single-flight refresh.
- GraphQL error parsing independent of HTTP status.
- Timeout, capped retry, jitter and reset-aware rate handling.
- Revision-aware analysis cache.
- Actor matching by canonical name/realm plus report master data; fail safely on ambiguity.
- Persist only normalized facts and required provenance long-term; raw event payload retention must be bounded.

## Current repository risks to address

- Static Mythic+ zone ID.
- Candidate runs currently default to `timed: true` and `seasonSlug: current`.
- Run fingerprint may use only the target player rather than a known roster.
- WCL visibility is persisted only when there is a run to attach an analysis to; define a character-level provider state if no run exists.
- `RunCombatFacts` contract remains provider-local (CR-02). Move the stable normalized contract to `@mplus/contracts` or document a deliberate boundary.

## Primary references

- WCL API v2 OAuth: https://www.warcraftlogs.com/api/docs
- WCL GraphQL schema explorer: https://www.warcraftlogs.com/v2-api-docs/warcraft/
- WCL OAuth guide: https://www.warcraftlogs.com/api/docs/guide
- WCL privacy policy: https://www.warcraftlogs.com/help/privacy
