# Live source reconciliation policy

## Precedence

| Field | Primary | Supporting/fallback | Conflict behavior |
|---|---|---|---|
| Identity/class/faction | Blizzard | Raider.IO | Blizzard wins; persist warning |
| Active spec | Blizzard specializations | Raider.IO played spec | Display both contextually; do not overwrite |
| Equipment/item level | Blizzard | Raider.IO gear | Newest valid value; show source and timestamp |
| Current Mythic rating | Blizzard | Raider.IO current score | Keep both separately; never merge silently |
| Recent/best runs | Raider.IO + Blizzard season best | WCL candidates | Deduplicate with confidence; preserve sources |
| Combat execution | WCL public logs | none | Optional evidence only |
| Visibility | WCL | none | Coverage state, not player penalty |

## Partial-provider matrix

| Blizzard | Raider.IO | WCL | Result |
|---|---|---|---|
| OK | OK | OK | Full MVP profile |
| OK | unavailable | OK | Profile + lower run/rank coverage |
| OK | OK | hidden/unavailable | Profile + lower WCL confidence only |
| OK | unavailable | unavailable | Blizzard-only provisional score if minimum observations exist |
| NOT_FOUND | any | any | Stable not-found/privacy-ambiguous response; stop dependent calls |
| rate-limited/transient | any | any | Queue retry; return stale snapshot when available |

## Freshness

TTL values are product configuration, not provider guarantees. Store both:

- source-provided timestamp where available,
- fetch timestamp,
- local expiry,
- stale reason.

A stale snapshot may be served while refresh runs, but the UI must label it.

## Score safety

- A provider outage must not be converted into a low player score.
- Confidence and score are separate values.
- Excluded observations and source conflicts must appear in the explanation payload.
- Structural snapshot validation blocks persistence; statistical/anomaly validation may warn.
