# Agent 01 Audit — Dynamic Season + Historical Provider Semantics

**Date:** 2026-08-09  
**Branch:** `fix/experience-evidence-completion`  
**Scope:** audit + provider-free rollover tests only (no scoring formula / persistence changes)

## Executive root causes

### R1 — Wallidrixe Experience unavailable (live provider proof)

For **Wallidrixe / Archimonde / EU** (runtime JSON: `AGENT01_WALLIDRIXE_RUNTIME.json`):

| Fact | Value |
|------|--------|
| Blizzard authoritative `current_season` | **17** |
| Chronological previous Blizzard season | **15** (index has no season **16**; previous ≠ current−1) |
| Current season window | start `1773806400000` (≈ 2026-03-18 UTC); end `null` (still current) |
| Previous season window | start `1754452800000` → end `1773806400000` |
| Blizzard previous season profile | **HTTP 404** (`BLZWEBAPI00000404`) |
| RIO `mythic_plus_scores_by_season:current:previous` | `[season-mn-1=4135.2, season-tww-3=0]` |
| Exact slug request `season-tww-3` | score **0** |
| `previous_mythic_plus_ranks.class.region` | **0** (unusable placeholder) |
| Current class region rank | **18** (must not be used as previous) |
| RIO cutoffs for `season-tww-3` | native `p999/p990/p900/p750/p600` present; **`isRemappedSeason: true`** |

**Why Experience becomes `PREVIOUS_EVIDENCE_UNAVAILABLE`:**

1. Production previous-rating path calls Blizzard season profile for the chronologically previous season → **404**.
2. Reclassification to `CONFIRMED_NO_ACTIVITY` requires Raider.IO corroboration (`rioPreviousSeasonCorroborationFromProfile`). That is wired in `refresh-bridge`, but **any path that omits the RIO profile** (live smoke, provider-disabled Experience, null `raiderIoProfile`) keeps `PROVIDER_FAILURE` / `BLIZZARD_404_UNCORROBORATED` → calculator reason **`PREVIOUS_EVIDENCE_UNAVAILABLE`**.
3. Even with corroboration → `CONFIRMED_NO_ACTIVITY` → score **0 available**, class-rank floor cannot help (previous ranks are 0). Baseline “unavailable” therefore indicates **missing corroboration and/or Experience Blizzard gate off**, not “character had previous-season M+ score that we failed to read”.
4. Standing path (when a finite rating exists) still depends on persisted previous-season population policy. Remapped historical cutoffs are a known `NO_USABLE_POLICY` risk → `MISSING_POPULATION_POLICY` → same unavailable reason.

### R2 — Raider.IO “previous” is relative shorthand, not Blizzard-bound

Official OpenAPI v0.62.5:

> `mythic_plus_scores_by_season` accepts aliases **`current`** and **`previous`**; results are returned **in request order**.

Repo normalizer takes `seasons[0]` / `seasons[1]` and labels them current/previous **without verifying** the slug against the Blizzard-selected previous season.

Live proof: RIO `previous` for Wallidrixe is `season-tww-3` (matches Blizzard 15 today), but this is **coincidence of aliases**, not a product-safe season bind. Exact slug fields work: `mythic_plus_scores_by_season:season-tww-3`.

### R3 — Event seasons can steal “previous” on same-expansion rollover

Live Midnight static-data (`expansion_id=11`) includes:

- `season-mn-1` (`is_main_season: true`, Blizzard 17)
- `season-mn-1-break-the-meta` (`is_main_season: false`, later start)
- `season-mn-2` (`is_main_season: true`, Blizzard 18, starts EU 2026-08-19)

Simulated “MN2 becomes current”:

| Selection rule | Selected previous |
|----------------|-------------------|
| All RIO seasons by start | **`season-mn-1-break-the-meta`** ❌ |
| Canonical slug regex `^season-[a-z]+-\d+$` | `season-mn-1` ✅ |
| Provider `is_main_season === true` | `season-mn-1` ✅ |

`resolveRaiderIoCurrentAndPrevious` (used for same-expansion RIO slug bind in Experience bootstrap) **does not filter** main seasons.  
`matchBlizzardSeasonToRaiderIoByDates` **does** filter via slug regex.

**Imminent rollover risk (~2026-08-19 EU):** bootstrap can bind previous `providerSeasonId` to Break-the-Meta and sync cutoffs for the wrong RIO season.

OpenAPI `SeasonStaticData` also exposes **`is_main_season`** (required) and **`blizzard_season_id`**. Both are **dropped** by `normalizeStaticData` today; contracts only keep slug/dates/`isCurrent`.

### R4 — Experience bootstrap is startup-scoped; authority TTL alone is not enough

Canonical current season: `synchronizeSeasonAuthority` → Blizzard `season_index.current_season` → `ensureBlizzardCurrentSeason` (flips `Season.isCurrent`, slug `blizzard-season-{id}`). Validity = Blizzard season-index TTL (**86400s**). Memory prefers still-valid DB authority so another process can repair without worker restart.

Experience previous + RIO slug + population policy sync run in `bootstrapExperienceSeasonMetadata` (worker startup soft path). After a live N→N+1 flip:

- refresh can resolve previous via DB `startsAt` **if hydrated**;
- **new previous season’s population policy may never have been synced** (policy sync targets “previous”, not “current”);
- RIO slug bind / cutoffs will not refresh until bootstrap runs again.

### R5 — Native cutoffs vs product interpolation

OpenAPI `SeasonCutoffs` native keys include **`p999`, `p990`, `p900`, `p750`, `p600`** (provider-native; descriptions 99.9th … 60th percentile) **plus** title cutoffs (`keystoneLegend`, `keystoneHero`, …) and timed brackets.

Repo `normalizeSeasonCutoffs` maps only the five `p*` keys into product labels `top0_1Percent` … `top40Percent`.  
`estimatePreviousSeasonStanding` / `scoreFromEstimatedTopPercent` then **interpolate** across those `topPercent` anchors — this is the custom abstraction product wants to simplify toward native bands.

`p999…p600` are a **stable documented subset**, not a repo invention, but they are **not the full** cutoff payload.

---

## Authoritative current / previous algorithm (as implemented)

```text
current:
  Blizzard GET mythic-keystone/season/index → current_season.id
  persist via ensureBlizzardCurrentSeason (isCurrent flip, slug blizzard-season-{id})
  authority metadata: source=season_index.current_season + authorityVerifiedAt

previous (Blizzard / DB):
  among same regionId seasons with blizzardSeasonId + startsAt < current.startsAt
  pick latest startsAt (resolvePreviousMythicSeason / pickPreviousSeasonByStartTimestamp)
  NEVER blizzardSeasonId - 1

RIO bind:
  same-expansion: resolveRaiderIoCurrentAndPrevious(static seasons) ⚠️ unfiltered
  cross-expansion: previous-expansion static-data + matchBlizzardSeasonToRaiderIoByDates (canonical slug filter)

previous rating:
  Blizzard getMythicKeystoneSeasonProfile(identity, previousBlizzardSeasonId)
  optional RIO corroboration of ambiguous 404 → CONFIRMED_NO_ACTIVITY
  RIO rating is NOT the primary standing source

population policy:
  Raider.IO getSeasonCutoffs(region, explicitSeasonSlug) → Season.metadata LKG
```

Scoring/recalculate paths that need an authoritative current season use season authority / `ensureBlizzardCurrentSeason`. Experience does **not** hard-code Midnight S1 / fixed RIO slugs / dungeon counts for previous selection. Hard-coded Midnight pools still exist in **canary** tooling (out of Experience evidence path).

---

## Raider.IO semantics (proven)

| Field | OpenAPI / live meaning | Safe for Experience? |
|-------|------------------------|----------------------|
| `mythic_plus_scores_by_season:current:previous` | Relative aliases; array order = request order | Only after slug === canonical previous |
| `mythic_plus_scores_by_season:{slug}` | Exact season score | Yes |
| `previous_mythic_plus_ranks` | “rankings for player”; **no season id in schema/payload** | Season identity **not provable** from field alone; fail closed unless bound another way |
| `mythic_plus_ranks` | Current season ranks | Must not substitute for previous |
| static-data seasons | `is_main_season`, `blizzard_season_id`, starts/ends | Prefer `is_main_season` (+ Blizzard id when retained) over slug regex alone |
| `season-cutoffs?season=&region=` | Optional season slug; returns native `p*` + more | Use explicit previous slug |

Slug regex is **necessary but accidental** relative to provider `is_main_season` (e.g. live `season-tww-1-post` is `is_main_season: true` but fails the regex).

---

## Recommended minimal implementation (Agents 02–04)

1. **Season bind (02):** Always select previous real Mythic+ season from Blizzard chronology; bind RIO only via `is_main_season` (retain in normalize/contracts) and/or Blizzard↔RIO date match; never trust unfiltered `resolveRaiderIoCurrentAndPrevious` for Experience.
2. **Request exact RIO season slugs** for score/rank evidence; treat `current:previous` as diagnostic only.
3. **Class rank:** fail closed unless rank can be proven for the bound previous season (today’s `previous_mythic_plus_ranks` lacks season provenance — escalate if no exact-season endpoint exists).
4. **Wallidrixe path:** keep Blizzard-first; 404 + RIO score≤0 → durable `CONFIRMED_NO_ACTIVITY`; never map rating 0 / below-range into synthetic standing 25 when evidence means no activity.
5. **Cutoffs (03):** score standing from native RIO quantile bands (`p999`…) without inventing extra percentiles; retain only provider-native keys.
6. **Persistence / replay (04):** immutable character+previous-season evidence; startup-only bootstrap insufficient across rollover — re-sync previous policy when authority current changes.
7. **Future-season tests:** keep invented-ID fixtures (`experience-season-rollover.audit.test.ts`); extend with policy+replay once persistence lands.

---

## Unresolved provider questions for Agent 02

1. Is there any Raider.IO field/endpoint that returns **class rank for an explicit season slug** (not only `previous_mythic_plus_ranks`)?
2. Should `season-tww-1-post`-style `is_main_season: true` non-canonical slugs count as “real” previous seasons for Experience?
3. For remapped historical cutoffs (`isRemappedSeason: true`), is the `p*` set complete enough for LKG policy, or must Experience fail closed / use a different historical feed?
4. Confirm production refresh always passes `raiderIoProfile` into Experience when Blizzard previous 404s (Wallidrixe).

---

## Validation

- Live provider audit script: `.cursor-orchestration/.../common/_wallidrixe-provider-audit.mjs` → `AGENT01_WALLIDRIXE_RUNTIME.json`
- Provider-free tests: `apps/worker/src/orchestration/scoring/experience-season-rollover.audit.test.ts`
- Primary docs: Raider.IO OpenAPI `https://raider.io/swagger.json` v0.62.5
