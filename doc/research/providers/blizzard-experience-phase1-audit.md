# Blizzard Experience Phase 1 â€” evidence audit

**Status:** research only (no implementation)
**Date:** 2026-08-08
**Scope:** previous-season official rating, relative population standing, historical 0.1% cutoff ownership
**Out of scope:** Current Exposure (global Trust Score difficulty modifier), WCL, Performance/Survival/Utility, composite weights, refresh/queues

Code is authority when it disagrees with older docs. Locked product decisions in the task prompt supersede `DIMENSION_PHASES.md` Experience Phase 1 wording where they conflict (notably: no class/spec rank; no current exposure inside Experience).

---

## Executive conclusion

1. **Previous-season official Mythic+ rating from Blizzard?** **Yes.**
   `GET /profile/wow/character/{realm}/{name}/mythic-keystone-profile/season/{seasonId}` (`namespace=profile-{region}`) returns the characterâ€™s seasonal Mythic+ rating for an arbitrary known `seasonId`. The repository already exposes this via `BlizzardProvider.getMythicKeystoneSeasonProfile`. Historical season IDs remain addressable after the season ends (no Blizzard â€œarchive expiryâ€ documented for this path).

2. **Previous-season population percentile directly from Blizzard?** **No.**
   There is **no** Profile or Game Data endpoint that returns a characterâ€™s regional/global Mythic+ score percentile or overall season rank. Connected-realm Mythic+ leaderboards are **dungeon Ã— period Ã— connected-realm run boards**, not season-score population distributions.

3. **Cheapest credible source architecture for relative standing?**
   **Strategy B:** periodic **region Ã— season** population-threshold sync (small cached `SeasonPopulationPolicy`), then **local** normalization of each characterâ€™s Blizzard previous-season rating. Prefer expanding the existing Raider.IO `season-cutoffs` *batch* path (or an equivalent offline threshold feed) into versioned DB rows â€” **not** `score character â†’ call Raider.IO`. Blizzard-only leaderboard crawling (Strategy A) is not credible. M+TS-only populations (Strategy C) must not be labelled as WoW population percentiles.

4. **Historical 0.1% cutoff ownership via Blizzard achievements?** **Yes, with caveats.**
   Character Achievements Summary can prove ownership of a specific achievement ID (including Feats of Strength), with `completed_timestamp` and criteria semantics that distinguish character vs account-visible completion. Blizzard does **not** expose an authoritative â€œseason â†’ 0.1% title achievementâ€ map; a **local versioned `EliteCutoffCatalog`** is required. The current `ELITE_ACHIEVEMENT_CATALOG_V1` is **not** safe to use as-is (wrong IDs / non-0.1% milestones).

5. **Per-character provider-call delta (Experience Phase 1 target):** typically **+1 to +2 Blizzard Profile calls** beyond what identity refresh already does:
   - **+1** previous-season mythic-keystone season profile (if not already persisted for that season).
   - **+1** character achievements summary (new; not implemented on `BlizzardProvider` today).
   Season index / previous-season binding and population thresholds are **not** per-character when cached.

6. **Cache globally per region/season (and statically):**
   - `SeasonPopulationPolicy` thresholds (k / percentile anchors) per `region + previousSeasonId`.
   - Authoritative current season + previous-season binding (from Blizzard season index + season detail timestamps / ordered IDs).
   - Versioned `EliteCutoffCatalog` (achievementId â†” season â†” verified 0.1% semantics).

---

## Current-state map

### Reusable

| Surface | Role | Reuse for Phase 1 redesign |
|---------|------|----------------------------|
| `BlizzardProvider.getMythicKeystoneSeasonProfile` | Official seasonal rating + best_runs | **Primary** previous-season rating source |
| `resolveAuthoritativeCurrentSeasonId` / `getMythicKeystoneSeasonIndex` / `getMythicKeystoneSeason` | Season authority | Bind `current â†’ previous` without hard-coded IDs |
| `ExperienceV3PreviousSeasonFact` + `scorePreviousSeasonStrengthV3` / `normalizePreviousSeasonScore` | Absolute score â†’ 0â€“100 via K thresholds | Reusable **shape** of â€œraw rating + policyâ€; policy source must become real population thresholds |
| `PreviousSeasonNormalizationPolicyV3` / `createPreviousSeasonPolicyV3` | Versioned K50/K90/K99 | Closest existing stand-in for `SeasonPopulationPolicy` |
| `ExperienceV3EliteHistoryFact` + `scoreEliteHistoryV3` | Elite title component | Reusable calculator pattern; catalog + age decay must change |
| `computeExperienceV3` provider-free calculator | Blend components | Keep calculator provider-free; change inputs/weights |
| `apps/worker/.../experience-history-loader.ts` | DB â†’ history facts | Replace RIO-centric previous-season / exposure wiring; keep DB-only finalization pattern |
| `RaiderIoProvider.getSeasonCutoffs` | Region cutoffs (optional) | Candidate **batch** feed for Strategy B (today only `p750`) |

### Contradicts locked Phase 1 product decisions

| Concept | Where | Why it no longer belongs |
|---------|-------|---------------------------|
| **`currentExposure`** (45% weight; gates AVAILABLE) | `packages/scoring/src/experience/v3/constants.ts` (`EXPERIENCE_V3_COMPONENT_WEIGHTS`), `types.ts`, `exposure.ts`, `compute.ts` (`resolveAvailability` requires exposure), `confidence.ts`, `experience-history-loader.ts`, `live-character-probe/experience.ts` | Current-season key exposure moved out of Experience |
| **`historicalRank`** / class-spec top-10 | `historical-rank.ts`, `types.ts`, `catalogs.ts` (`createHistoricalRankPolicyV3`), loader `buildHistoricalRankFact` (RIO ranks) | Explicitly excluded from Experience Phase 1 |
| **Raider.IO as previous-season score source** | `experience-history-loader.ts` â†’ `buildPreviousSeasonFact` | Preferred source is Blizzard official rating; RIO may only feed **global** thresholds |
| **Age decay on elite history** | `constants.ts` (`eliteHistory.ageDecayPerSeason` / `ageDecayFloor`), `elite-history.ts` (`ageFactor`) | Locked: confirmed 0.1% cutoff has **no age decay** |
| **Ordinary Keystone Master/Hero as elite** | `catalogs.ts` `ELITE_ACHIEVEMENT_CATALOG_V1` | Not true seasonal 0.1% titles |
| **Experience UNAVAILABLE when current exposure provider fails** | `compute.ts` (`exposureProviderFailed` â†’ score null) | Must not require current exposure for Experience availability |

### Eventually retire / replace

- V3 components `currentExposure` and `historicalRank` (and RIO rank mapping).
- Manual seed thresholds `EXPERIENCE_V3_PREVIOUS_SEASON_DEFAULT_K` (`k50: 2000, k90: 2800, k99: 3200`) in the history loader.
- Entire `ELITE_ACHIEVEMENT_CATALOG_V1` seed contents (IDs/titles/semantics incorrect â€” see catalog audit below).
- Experience V2 exposure metric path (`packages/scoring/src/experience/v2/**`) as the primary Experience signal once Phase 1 redesign lands (may remain for non-Experience â€œcurrent exposureâ€ elsewhere â€” out of scope here).
- Doc debt: `doc/scoring/DIMENSION_PHASES.md` Experience Phase 1 still lists class/spec ranking and does not reflect the locked decisions (do not treat as product authority for this chantier).

### Elite catalog audit (`ELITE_ACHIEVEMENT_CATALOG_V1`)

Authoritative Wowhead checks (2026-08-08). Classifications:

| achievementId | Catalog claim | Authoritative title / semantics | Class |
|---------------|---------------|----------------------------------|-------|
| 14196 | â€œKeystone Hero: Dragonflight Season 1â€, percentile 1 | Wowhead: **The Waking Dream** (raid) | **NOT_0_1_CUTOFF** |
| 16647 | â€œKeystone Hero: DF Season 2â€, percentile 1 | Wowhead: **Dragonflight Keystone Explorer: Season One** (750 rating) | **NOT_0_1_CUTOFF** |
| 17850 | â€œKeystone Hero: DF Season 3â€, percentile 1 | Wowhead: **Keystone Hero: Neltharion's Lair** (dungeon teleport FoS) | **NOT_0_1_CUTOFF** |
| 19049 | â€œKeystone Hero: DF Season 4â€, percentile 1 | Wowhead: **Canopy Concours: Gold** | **NOT_0_1_CUTOFF** |
| 20525 | â€œTWW Keystone Master: Season Oneâ€, percentile 1 | Wowhead: Master **2000 rating** milestone | **NOT_0_1_CUTOFF** |
| 20526 | â€œTWW Keystone Hero: Season Oneâ€, percentile **0.1** | Wowhead: Hero **2500 rating** milestone (not 0.1%) | **NOT_0_1_CUTOFF** |
| 20985 | â€œTWW Keystone Master: Season Twoâ€ | Wowhead **404** for this ID | **UNVERIFIED** |
| 20986 | â€œTWW Keystone Hero: Season Twoâ€, percentile **0.1** | Wowhead **404** for this ID | **UNVERIFIED** |

**Confirmed true 0.1% seasonal titles exist** (Blizzard news / warcraft.wiki.gg Feats of Strength/Dungeons), e.g. Thundering / Smoldering / Dreaming / Draconic Hero (DF), Tempered / Enterprising / Unbound Hero (TWW). **No achievement IDs for those titles are asserted here** (prompt: do not guess IDs). Future catalog work must map IDs from Game Data `data/wow/achievement/{id}` + authoritative reward text before any `CONFIRMED_0_1_CUTOFF` entry is shipped.

**Zero catalog rows are `CONFIRMED_0_1_CUTOFF` today.**

---

## Blizzard capability audit

### 1. Previous-season official Mythic+ score

| Item | Finding |
|------|---------|
| **Endpoint** | `GET https://{region}.api.blizzard.com/profile/wow/character/{realmSlug}/{characterName}/mythic-keystone-profile/season/{seasonId}` |
| **Namespace** | `profile-{region}` |
| **Expected rating field** | Community/official client types (`@blizzard-api/wow`) document season details as **`mythic_rating.rating`**. Repo schema/normalizer currently read **`current_mythic_rating.rating`** (fixtures too). **Implementation must accept both** until live schema revalidation; this is a real contract risk, not a product blocker. |
| **Repo API** | `getMythicKeystoneSeasonProfile(identity, seasonId, ctx)` â†’ `profile.currentMythicRating` + `runs` |
| **No activity** | Official client docs: **404** when the character has not completed a Mythic Keystone dungeon for that season. |
| **Hidden / private** | Character Profile endpoints generally return **404** when missing **or** Share Game Data off (`PROFILE_UNAVAILABLE` in repo). Same endpoint key `character.mplus.season` is classified as a character-profile endpoint â†’ 404 â†’ `PROFILE_UNAVAILABLE`. **Ambiguity:** season 404 alone cannot distinguish â€œno season activityâ€ vs â€œprofile privateâ€ unless another successful profile call on the same character exists. |
| **After season ends** | Path remains keyed by `seasonId`; completed seasons stay queryable. No documented purge of historical season profiles. |
| **Schemas retain enough?** | Rating + season id + best_runs: **mostly yes**, pending `mythic_rating` vs `current_mythic_rating` reconciliation. Percentile is **not** in the payload (expected). |
| **Contract change necessary?** | Optional but recommended: normalize seasonal rating from `mythic_rating \|\| current_mythic_rating`; optionally expose a dedicated DTO field `seasonMythicRating`. Achievements API is a **new** provider method. |

#### Resolving `current season â†’ immediately previous season`

Do **not** hard-code season IDs.

Existing authority:

1. `data/wow/mythic-keystone/season/index` â†’ `current_season.id` (`resolveAuthoritativeCurrentSeasonId`).
2. Same index `seasons[]` lists known season IDs.
3. `data/wow/mythic-keystone/season/{id}` supplies `start_timestamp` / `end_timestamp` when needed (`getMythicKeystoneSeason`).

Reliable binding algorithm (design):

- Prefer: among seasons with `end_timestamp < current.start_timestamp` (or `id < current` when timestamps missing), choose the latest by `start_timestamp` / id.
- Local DB already approximates this in `loadExperienceHistoryFromDb` via `prisma.season.findFirst` ordered by `startsAt` â€” keep that as app catalog binding once Blizzard IDs are synced into `Season` rows.

There is **no** dedicated â€œprevious_seasonâ€ field on the Blizzard season index.

### 2. Relative population standing / percentile

**Direct Blizzard percentile API:** **does not exist.**

#### Strategy A â€” Blizzard-only season distribution

**Not recommended.**

- Leaderboard API: `GET /data/wow/connected-realm/{connectedRealmId}/mythic-leaderboard/{dungeonId}/period/{periodId}` (`dynamic-{region}`), already wrapped as `getConnectedRealmMythicLeaderboard`.
- Payload: `leading_groups[]` with dungeon run ranking (key level, duration, members) for **one dungeon, one weekly period, one connected realm**.
- This is **not** overall Mythic+ season score and **not** a region-wide score percentile. Equating dungeon leaderboard rank to season standing is **false**.
- Rough cost to â€œcrawlâ€ one region Ã— season: `#connectedRealms Ã— #dungeons (~8) Ã— #periods (~12â€“16+)` â†’ **O(10Â³â€“10â´+) calls**, still without a season-score CDF unless every characterâ€™s season profile is also fetched (another O(population) explosion). Explicitly forbidden as a per-character crawl pattern in the provider contract comments.

#### Strategy B â€” cached external season thresholds (preferred)

Acceptable shape:

```text
periodic region/season cutoff sync â†’ persist SeasonPopulationPolicy â†’
all character Experience calculations use local DB
```

Raider.IO today:

| Item | State |
|------|--------|
| Endpoint | `GET /api/v1/mythic-plus/season-cutoffs?region={region}` |
| Repo | `RaiderIoProvider.getSeasonCutoffs` |
| Retained fields | **Only** `cutoffs.p750` â†’ `top25Percent` (`RaiderIoSeasonCutoffs`) |
| Missing for Experience | Finer quantiles needed for continuous standing (community clients cite `p999` / `p990` / `p900` / `p600` on the same endpoint; **not** retained by current Zod/normalizer). Historical completed-season query params / pinning must be confirmed before relying on post-season freeze. |
| Reliability | Documented as optional; live 500s observed (`doc/research/providers/raiderio-live-api.md`) |
| Legal | Attribution + commercial terms remain a launch gate (`doc/api/raiderio/terms-and-commercial-risk.md`) |

RIO character profile previous-season **scores** are already used by the Experience loader â€” that per-character dependency should be **retired** for Experience Phase 1 in favour of Blizzard rating + local policy.

#### Strategy C â€” local M+TS population

**Reject for â€œWoW population percentileâ€ claims.**

M+ Trust Factor users are a self-selected subset (lookup / refresh behaviour). Percentiles over that set measure â€œrelative among people who use M+TS,â€ not Mythic+ regional population. Fine for internal calibration diagnostics; **not** for product Experience standing labelled as top X% of WoW.

### 3. Historical 0.1% cutoff evidence

| Item | Finding |
|------|---------|
| **Endpoints** | Character: `GET /profile/wow/character/{realm}/{name}/achievements` (`profile-{region}`). Optional stats: `.../achievements/statistics`. Catalog: `GET /data/wow/achievement/{achievementId}` (`static-{region}`). |
| **Repo** | **Not implemented** on `BlizzardProvider`. |
| **Relevant fields** | Per completion: `id`, `achievement.id`, optional `completed_timestamp`, `criteria.is_completed` (+ child criteria). |
| **Timestamps** | `completed_timestamp` present when completed (ms epoch). |
| **Privacy** | Same Share Game Data / profile visibility rules as other character Profile APIs (404 / restricted). |
| **Feats of Strength / seasonal titles** | Exposed on the character achievements summary when earned; FoS are ordinary achievement IDs in Game Data. |
| **ID stability** | Achievement IDs are stable catalog identifiers suitable for a versioned local map. |
| **Season â†” 0.1% title map from Blizzard?** | **No.** Descriptions on Game Data achievement resources + local verification are required. |
| **Character vs account** | Blizzard forum semantics: for many achievements, `completed_timestamp` can appear from **account** completion while `criteria.is_completed` reflects **this character**. Use that to set `CHARACTER_CONFIRMED` vs `ACCOUNT_VISIBLE` (existing V3 visibility enum is well-aligned). |

---

## Target architecture assessment

```text
Blizzard character previous-season profile
                  |
                  v
      raw previous-season rating
                  |
                  +---- SeasonPopulationPolicy (region Ã— season, cached)
                  |
                  v
       relative standing score


Blizzard character achievements
                  |
                  +---- EliteCutoffCatalog (versioned, verified 0.1% only)
                  |
                  v
        historical elite evidence


relative standing + elite evidence
                  |
                  v
          Experience calculator (provider-free)
```

**Feasible.** Matches existing V3 separation of facts vs calculator. Main work is evidence loading + catalog/policy persistence, not inventing a new scoring host.

---

## Evidence-source matrix

| Signal | Preferred source | Endpoint/data | Scope | Refresh frequency | Persisted identity | Failure semantics | Confidence |
|--------|------------------|---------------|-------|-------------------|--------------------|-------------------|------------|
| Previous-season raw rating | Blizzard Profile | `mythic-keystone-profile/season/{seasonId}` â†’ `mythic_rating` / `current_mythic_rating` | Character Ã— season Ã— region | On character Experience refresh / TTL | Character + Blizzard seasonId + content hash | 404 with successful sibling profile â†’ `CONFIRMED_NO_ACTIVITY`; profile-wide 404 â†’ unavailable / private; 429/5xx â†’ `PROVIDER_FAILURE` | High when HAS_VALUE |
| Previous-season relative percentile | Derived locally | `SeasonPopulationPolicy` thresholds + raw rating | Region Ã— season (policy); character (derived) | Policy: periodic (daily/weekly) or season-frozen snapshot | `region + seasonId + policyVersion` | Missing policy â†’ component PARTIAL/UNAVAILABLE (do not invent); never call RIO per character | Mediumâ€“high once policy calibrated |
| Historical 0.1% cutoff ownership | Blizzard Profile + local catalog | `.../achievements` âˆ© `EliteCutoffCatalog` | Character | On Experience refresh / long TTL | Character + achievementId + visibility + completedAt | Missing achievements â†’ elite absent (score 0 / omit), not fabricate; private profile â†’ elite unknown | High when `CHARACTER_CONFIRMED` + catalog `CONFIRMED_0_1_CUTOFF` |
| Season â†’ previous season binding | Blizzard Game Data (+ local Season table) | `mythic-keystone/season/index` + `season/{id}` timestamps | Region | Season rollover / season-index TTL | `region + currentSeasonId â†’ previousSeasonId` | If binding unknown â†’ do not guess previous rating | High when timestamps/IDs consistent |
| Region/season population policy | External batch (RIO cutoffs preferred) or curated freeze | `mythic-plus/season-cutoffs` (expanded) â†’ DB | Region Ã— season | Periodic during season; freeze after season end | Policy row version + source stamp | Cutoffs 5xx â†’ keep last good policy or mark uncalibrated | Medium until multi-quantile retention + freeze rules proven |

---

## API cost analysis

### Per-character (Experience Phase 1)

| Call | Count | Notes |
|------|-------|-------|
| Previous-season M+ profile | 0â€“1 | Skip if fresh persisted season payload exists |
| Character achievements summary | 0â€“1 | New; filter client-side against catalog IDs |
| RIO character profile | **0** (target) | Remove Experience dependency |
| WCL | **0** | Protected / out of scope |

**Target steady-state delta: â‰¤ 2 Blizzard calls per Experience refresh.**

### Per-season / per-region (shared)

| Call | Count | Notes |
|------|-------|-------|
| Season index | 1 / region / TTL | Current + candidate previous |
| Season detail for previous (and current if needed) | 1â€“2 / region | Timestamps for binding |
| Population cutoffs sync | 1 / region / sync interval | RIO season-cutoffs or equivalent |
| Optional: Game Data achievement metadata for new catalog IDs | O(#new titles) once | Not per character |

### One-time / static

| Data | Notes |
|------|-------|
| `EliteCutoffCatalog` | Hand-verified FoS IDs; version bump on season add |
| Provider fixtures for achievements + dual rating fields | Test-only |

### Strategy A cost (rejected)

Thousands of leaderboard calls per region per season **without** producing season-score percentiles â€” exclude from plan.

---

## Proposed contracts â€” design only

Do **not** edit `@mplus/contracts` in this chantier. Illustrative shapes:

```ts
/** Character evidence: official previous-season Mythic+ rating. */
interface PreviousSeasonStandingEvidence {
  region: "EU" | "US" | "KR" | "TW";
  previousSeasonId: number;          // Blizzard season id
  previousSeasonSlug: string;        // app / policy slug
  evidenceState:
    | "HAS_VALUE"
    | "CONFIRMED_NO_ACTIVITY"
    | "PROVIDER_FAILURE"
    | "PROFILE_UNAVAILABLE"
    | "UNKNOWN";
  rawRating: number | null;          // Blizzard mythic rating
  source: "BLIZZARD";
  fetchedAt: string | null;          // ISO
  /** Filled only after applying SeasonPopulationPolicy locally. */
  relativeStanding: {
    policyId: string;
    policyVersion: string;
    /** Continuous 0â€“1 mass below this rating, or null if policy incomplete. */
    cdfApprox: number | null;
    /** e.g. 0.1 means top 0.1% when known. */
    topPercentApprox: number | null;
  } | null;
}

/** Small cached dataset: one row per region + season. */
interface SeasonPopulationPolicy {
  id: string;
  version: string;
  region: string;
  seasonId: string;                  // Blizzard or app season key
  seasonSlug: string;
  /** Absolute rating anchors (extend as needed). */
  thresholds: Array<{
    label: string;                   // e.g. "p50" | "p90" | "p99" | "p99_9" | "top_0_1"
    topPercent: number;              // 50, 10, 1, 0.1, ...
    score: number;
  }>;
  source: "RAIDER_IO_CUTOFFS" | "MANUAL_FREEZE" | "BLIZZARD_FORUM_CUTOFF" | "OTHER";
  sampleSize: number | null;
  confidence: number;                // 0â€“1
  effectiveAt: string;
  frozen: boolean;                   // true after season end snapshot
}

interface EliteCutoffEvidence {
  evidenceState: "HAS_VALUE" | "CONFIRMED_ABSENCE" | "PROVIDER_FAILURE" | "UNKNOWN";
  completions: Array<{
    achievementId: number;
    visibility: "CHARACTER_CONFIRMED" | "ACCOUNT_VISIBLE" | "AMBIGUOUS" | "ABSENT" | "UNKNOWN";
    completedAt: string | null;      // from completed_timestamp
    catalogVersion: string;
  }>;
}

interface EliteCutoffCatalogEntry {
  achievementId: number;
  seasonIdOrSlug: string;
  title: string;
  /** Must be true seasonal Mythic+ 0.1% cutoff / title FoS. */
  verification: "CONFIRMED_0_1_CUTOFF";
  regionScope: "REGION" | "REGION_FACTION" | null;
  evidenceSemantics: "season_mythic_plus_top_0_1_title";
  version: string;
  /** Optional notes / sources for auditors (URLs, patch). */
  verificationRefs?: string[];
}
```

Calculator remains provider-free: it consumes `PreviousSeasonStandingEvidence` (with policy already applied or passed alongside) + `EliteCutoffEvidence`, never HTTP clients.

---

## Future implementation blast-radius map

Smallest expected surfaces (future agents â€” **not** this task):

### 1. Blizzard provider
- `packages/providers/blizzard/src/live-provider.ts` (+ fixture/schemas/normalize): seasonal rating field dual-read; **new** `getCharacterAchievementsSummary`; clarify season 404 vs profile privacy when composing evidence.
- `packages/contracts/src/provider.ts`: optional DTO / method additions.
- Fixtures under `tools/fixtures/blizzard/**`.

### 2. Persistence
- New tables/rows for `SeasonPopulationPolicy` and possibly elite evidence cache (Prisma migration in a later chantier).
- Reuse `ExternalPayload` / provider state patterns for achievements + previous-season profile.

### 3. Experience evidence loader
- `apps/worker/src/orchestration/scoring/experience-history-loader.ts` â€” replace RIO previous-season / historicalRank / currentExposure assembly.
- Acquisition path that **persists** Blizzard season profile + achievements **before** DB-only finalization (worker orchestration owned carefully; do not casually edit protected refresh core without a dedicated prompt).

### 4. Experience calculator
- `packages/scoring/src/experience/v3/**` â€” drop exposure/historicalRank from Phase 1 weights; remove elite age decay; replace catalog; keep `computeExperienceV3` provider-free.

### 5. Tests
- Provider contract tests; loader unit tests; calculator golden tests; cutoff policy application tests.
- **No** live Blizzard/WCL in CI by default.

### 6. Docs
- Update Experience Phase 1 in `doc/scoring/DIMENSION_PHASES.md` after product review.
- Link this audit from `doc/research/providers/` / scoring Experience specs.

### Must remain untouched (unless a future prompt explicitly expands)

- `packages/providers/warcraftlogs/**`
- `packages/scoring/src/performance/**`, `survival/**`, `utility/**`
- `packages/abilities/**`, WCL digests/selection/cache/budget
- `apps/worker/src/orchestration/refresh-pipeline.ts` (unless a later scoped wiring prompt)
- BullMQ / admission / publication / composite weights / `packages/scoring/src/model/defaults.ts`
- Frontend, addon, lockfiles (except when a dedicated implementation prompt requires deps)

---

## Open questions / blockers

1. **Live rating field name** on season profile (`mythic_rating` vs `current_mythic_rating`) â€” fixture/repo vs `@blizzard-api/wow` disagreement; needs one credentialed sample (separate smoke), no crawl.
2. **Season 404 disambiguation** â€” confirm operational rule: â€œcharacter profile OK + season 404 â‡’ `CONFIRMED_NO_ACTIVITY`â€ vs treat all season 404 as unavailable.
3. **Raider.IO season-cutoffs multi-quantile + historical season pin** â€” OpenAPI/fixture today emphasize `p750`; confirm live payload keys, season parameter, and post-season freeze behaviour before depending on them for k50/k90/k99/0.1%.
4. **Elite catalog rebuild** â€” verified 0.1% achievement IDs not yet recorded in-repo; blocked until Game Data + Wowhead/wiki cross-check per season (no guessing).
5. **Faction-scoped 0.1%** â€” some older titles were faction-scoped; Blizzard achievements may not encode faction of award. Confirm whether Experience treats all CONFIRMED FoS equally regardless of faction.
6. **Raider.IO commercial/attribution gate** â€” if Strategy B uses RIO thresholds in production scoring, legal review remains a launch blocker even when calls are batch-only.
7. **Product doc drift** â€” `DIMENSION_PHASES.md` Experience Phase 1 still lists class/spec ranking; reconcile after this audit is accepted.

---

## References (authoritative / primary)

- Blizzard Developer Portal â€” WoW Profile / Game Data APIs: https://develop.battle.net/documentation/world-of-warcraft
- Character Mythic Keystone Profile season path + 404-no-activity semantics: `@blizzard-api/wow` / FuzzyStatic `blizzard` client docs
- Character Achievements Summary path + account vs character criteria: Blizzard API forum thread â€œCharacter Achievements API: When is an achievement completed?â€
- Mythic Keystone Leaderboard: connected-realm Ã— dungeon Ã— period only
- Repo: `doc/research/providers/blizzard-live-api.md`, `packages/providers/blizzard/**`, `packages/scoring/src/experience/v3/**`, `apps/worker/src/orchestration/scoring/experience-history-loader.ts`
- True 0.1% title semantics: Blizzard news / warcraft.wiki.gg Feats of Strength (Dungeons)
- Raider.IO: `doc/research/providers/raiderio-live-api.md`, OpenAPI `https://raider.io/swagger.json` (`/api/v1/mythic-plus/season-cutoffs`)

---

## Validation notes (this task)

- Documentation-only change: this file.
- No live Blizzard credentialed calls.
- No Warcraft Logs calls.
- No database mutation.
