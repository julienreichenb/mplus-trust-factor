# Warcraft Logs API — Wave 3 public-data integration notes

**Research date:** 2026-07-27  
**Status:** implementation guidance, not legal advice.  
**Wave 3 agent:** 14 — public live hardening applied in `@mplus/provider-warcraftlogs`.

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

Map application regions to WCL region values explicitly. Preserve the target character in `ProviderFetchContext.targetCharacter`; do not fall back to default environment identity during a normal refresh. Live and fixture `getReportFightDetails` **require** `ctx.targetCharacter`.

## Public evidence flow

Use a bounded sequence:

1. resolve character and public/hidden state;
2. retrieve current Mythic+ zone rankings when a valid **non-expired** current zone ID is known;
3. retrieve a bounded page of recent public reports (`limit=20`, page 1 only);
4. build candidates capped at `MAX_DISCOVERY_CANDIDATES` (25);
5. analyze at most the selected latest/highest credible run(s) (`MAX_ANALYSIS_FIGHTS=2`);
6. fetch report fights/master data (**without** `allowUnlisted`);
7. resolve the target actor (fail on ambiguity);
8. page only the required event types (`MAX_EVENT_PAGES=10`, `MAX_EVENTS_PER_CATEGORY=2000`) and produce normalized combat facts.

Relevant GraphQL surfaces include:

- Character `encounterRankings` per active-season dungeon (preferred scoring discovery); `zoneRankings` Parses as legacy fallback.
- Character hidden/public state and server identity.
- Report fights, master data/actors, player details and events (post-selection detailed acquisition only).
- `rateLimitData` with hourly allowance, points spent and `pointsResetIn` (seconds until reset).

## Privacy and visibility

- Never discover or display private reports.
- Do not set `allowUnlisted: true` in generic report lookup. Unlisted codes must not be probed or exposed.
- Public client credentials do not authorize access to private reports.
- Archived report detail can be unavailable without archive access; classify this as unavailable evidence, not player fault.
- Combat logs exist only when someone records and uploads them. No public logs, hidden logs or partial events must lower WCL coverage/confidence only; they must not directly reduce the player’s performance score.

Visibility states (provider-local; contracts CR pending for API surface):

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
- hard stop threshold (`STOP` → character-level `RATE_LIMITED` discovery result),
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

Live mode requires an explicit zone ID via constructor `zoneId` or `WCL_MPLUS_ZONE_ID`.  
Optional `WCL_MPLUS_ZONE_EXPIRES_AT` (ISO) alarms stale mappings; expired zones **skip** `zoneRankings` (no `recentReports` discovery fallback).

Agent 11 should formalize these env vars in `@mplus/config`. Fixture mode may use `FIXTURE_MPLUS_ZONE_ID` only.

## Run matching quality

Candidate mapping no longer uses optimistic placeholders:

- `timed` is `null` until timer evidence exists; MythicRunDTO mapping uses `false` (never claims timed);
- `seasonSlug` stays `null` / sentinel `unknown` until season metadata is wired;
- unknown dungeons stay `null` / sentinel `unknown`;
- candidates without a known `fightId` are not discovery-eligible (no recentReports / fightUnknown mass-hydration path);
- roster incompleteness is explicit; match confidence is attached when `matchRunCandidate` is used;
- do not attach combat facts below documented confidence thresholds (worker/scoring).

## Reliability requirements

- OAuth token cache and single-flight refresh.
- GraphQL error parsing independent of HTTP status (archive → unavailable evidence; rate messages → `RATE_LIMITED`).
- Timeout, capped retry, jitter and reset-aware rate handling.
- Revision-aware analysis cache.
- Actor matching by canonical name/realm plus report master data; **fail safely on ambiguity**.
- Persist only normalized facts and required provenance long-term; raw event payload retention must be bounded.

## Contract boundary

`RunCombatFacts` remains exported from `@mplus/provider-warcraftlogs`. See  
Shared-package contract changes for extended combat facts belong in `@mplus/contracts` with a PR that stays backward compatible.

## Primary references

- WCL API v2 OAuth: https://www.warcraftlogs.com/api/docs
- WCL GraphQL schema explorer: https://www.warcraftlogs.com/v2-api-docs/warcraft/
- WCL OAuth guide: https://www.warcraftlogs.com/api/docs/guide
- WCL privacy policy: https://www.warcraftlogs.com/help/privacy
