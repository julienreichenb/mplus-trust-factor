# Blizzard realm visibility (public catalog)

Research date: 2026-07-31  
Regions inspected live: **EU, US, KR, TW**  
Endpoints: Realm Index + Realm detail (`dynamic-{region}`).  
Connected Realm Index/details were evaluated conceptually against observed detail `connected_realm` fields (every sampled technical realm also had a connected-realm id).

Credentials and access tokens were never logged or committed.

## Facts observed in current API payloads

### Realm Index (`GET /data/wow/realm/index`)

Approximate entry counts (live):

| Region | Index entries |
|--------|---------------|
| EU | 361 |
| US | 344 |
| KR | 40 |
| TW | 52 |

The index mixes:

- Legitimate player realms (localized names, accents, apostrophes).
- Technical **Account Realm** entries (`EU1A Account Realm`, …) — English phrase is invariant across regions.
- Technical **instance/shard** entries whose **names** keep `-INST` / `-INST-*` while **slugs** often collapse hyphens (`EU7A1-INST` → `eu7a1inst`).
- Occasional **BG** cell names (`EU7A-BG-RU`).
- **Service** names: `Arena Pass`, `Auxiliary`, `GMSupport …` (TW).

### Realm detail (`GET /data/wow/realm/{slug}`)

Sampled legitimate realms:

- `is_tournament: false`
- Non-null `connected_realm` (id or href)
- Normal locale / timezone / category (language or region labels)

Sampled technical realms (Account Realm, INST, BG, Arena Pass, Auxiliary, GMSupport):

- Almost always **`is_tournament: false`** even when category is `Tournament` or `Test Server`
- **Also** expose a `connected_realm` id (often equal to the realm id)
- Therefore **connected-realm membership alone cannot define “public”**

No documented generic `is_public` field was present on these payloads.

### Connected Realm API as a canonical filter

**Decision: not adopted as the sole public-membership source.**

Reason (fact): every inspected technical realm detail still carried `connected_realm`. Using Connected Realm Index as an allowlist would require proving technical realms are absent there; current evidence from realm details shows they participate in connected-realm linkage, so CR membership is **not** a reliable public/internal split.

Connected-realm id remains a **completeness** requirement for activating a realm (legitimate realms have one), but it is not a substitute for naming/`is_tournament` classification.

## Defensive assumptions

- Blizzard may add new technical families; naming rules are narrowly scoped to confirmed tokens (`Account Realm`, `-INST`, cell `BG`, `Arena Pass`, `Auxiliary`, `GMSupport`).
- Index responses with fewer than a small plausibility threshold of entries are treated as provider faults (do not wipe a region).
- A transient detail failure must not deactivate a previously validated public realm.

## Fallback naming rules (implemented)

Reject when:

1. `is_tournament === true`
2. Name/slug matches **Account Realm**
3. Name/slug matches **INST** shard patterns (including collapsed slugs)
4. Name/slug matches **BG / Arena Pass / Auxiliary / GMSupport** service patterns
5. Required detail fields missing (id, name, slug, retail region, connected realm id)

Preserve legitimate realms regardless of language, accents, apostrophes, hyphens, RP, population, or localized category labels.

## Public catalog lifecycle (product rule)

Realm Index is discovery-only. An index row must **not** become an active public catalog row until detail classification succeeds as eligible. Ineligible and early-rejected technical rows are stored **inactive** (not hard-deleted).
