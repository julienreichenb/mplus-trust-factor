# Experience v3 — provider feasibility (Agent 25)

Character smoke target: `EU/archimonde/Wallidrixe`  
Formula version: `experience-v3-v1`  
Score model: **unchanged** (`default@2` remains active; `default@3` owned by Agent 27)

## Feasibility decision

| Capability | Public arbitrary profile | Authenticated / verified user | Decision |
|---|---|---|---|
| Same-character rename/transfer continuity | WCL `canonicalID` | Same | **AVAILABLE** — identity continuity only, not alts |
| Current-season rating / score | Blizzard M+ rating + Raider.IO current score | Same | **AVAILABLE** |
| Previous-season score | Raider.IO `mythic_plus_scores_by_season:current:previous` | Same | **AVAILABLE** (Wave 4 field set) |
| Deep multi-season archives | Blizzard season profile by `seasonId` (client credentials) | Same + optional user OAuth roster | **PARTIAL** — callable but needs per-season normalization ceilings |
| Public main/alt graph | Not reliably exposed by WCL or Blizzard public APIs | N/A | **BLOCKED** |
| Account-wide character list | Not public | Blizzard Battle.net user OAuth + Wow Profile | **BLOCKED until product OAuth** |
| Infer alts from guild / roster / logs | Technically possible, policy-forbidden | Forbidden | **REJECTED** |

**Ship mode for Wave 4 public profiles:** `CHARACTER_HISTORY` only.

**Verified account mode:** designed and implemented behind explicit linkage (`USER_CLAIM` / `BLIZZARD_OAUTH`). Do not enable without consent UX.

## Provider audit notes

### Warcraft Logs

- `canonicalID` follows the same character across rename/transfer.
- Public GraphQL (`/api/v2/client`) does **not** enumerate account alts for arbitrary players.
- User endpoint (`/api/v2/user`) is out of scope for public Trust Factor lookups.

### Blizzard

- Server **client-credentials** OAuth powers character profile + mythic-keystone season endpoints for any public character.
- `GET .../mythic-keystone-profile/season/{id}` is the honest deep-history path for **that character**.
- Account character enumeration requires **user-authorized** Battle.net OAuth (not implemented). Schema already has `BattleNetAccount` / `AccountCharacter` placeholders for a future verified flow.

### Raider.IO

- Documented field `mythic_plus_scores_by_season:current:previous` returns ordered season scores (Wave 4 minimal field set).
- No supported public API field for account-wide alts suitable for product scoring.
- Commercial/attribution terms still gate monetized launch (unchanged from Agent 13).
- Season cutoffs remain optional; when missing, Experience marks normalization **PARTIAL** and uses a transparent heuristic ceiling (never invents zero).

## Wallidrixe without account authentication

What can be shown today:

1. Label **CHARACTER_HISTORY** (not verified account).
2. Current-season peak from Blizzard rating and/or Raider.IO current score (season-normalized).
3. Current-season breadth from selected / best-run dungeon coverage with diminishing returns.
4. Previous-season score when Raider.IO returns it — season-normalized + age-decayed for historical peak.
5. Longevity from distinct active seasons observed on this character.
6. Explicit missing metric: `account_linked_alts` with availability **BLOCKED**.

What must **not** be shown as fact:

- Inferred alt list
- “Account experience” wording
- Raw Legion-era scores compared to modern ratings

Missing alt graph **must not** lower the Experience score.

## Required future OAuth / product flow

1. User signs in with Battle.net (authorization code grant).
2. Product fetches the authorized Wow account character list.
3. User confirms which characters to include (explicit claim; optional guildmates ignored).
4. Worker re-runs Experience with `accountLinkageVerified=true` and `verified: true` histories only.
5. UI switches label to **VERIFIED_ACCOUNT_HISTORY**.
6. User can revoke linkage; mode falls back to `CHARACTER_HISTORY` without score penalty for missing alts.

## Age-decay policy

- `decayed = seasonNormalized × max(0.35, 0.85 ^ seasonsAgo)`
- Floor keeps exceptional old achievements non-zero after heavy decay.
- Only **season-normalized** values enter historical peak math.

## Baseline verified formula (also used for public character scope)

| Contributor | Weight | Metric key |
|---|---:|---|
| Current peak | 45% | `experience.current_peak` |
| Current breadth (diminishing returns) | 25% | `experience.current_breadth` |
| Historical peak (normalized + decay) | 20% | `experience.historical_peak` |
| Longevity | 10% | `experience.longevity` |

Unavailable contributors are removed and weights renormalized. Missing ≠ zero.
