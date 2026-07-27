# Wave 4 — Data requirements and source matrix

## 1. Current-season selected runs

| Fact | Primary source | Fallback | Notes |
|---|---|---|---|
| Active season | Blizzard / Raider.IO static data | configured season | Must not use placeholder-current |
| Highest run per dungeon | canonical fused runs | Raider.IO profile runs | One run per dungeon |
| Key level, duration, timed | Raider.IO / Blizzard | WCL fight metadata | Canonical reconciliation required |
| Run score | Raider.IO | Blizzard rating context | Tiebreak only |
| WCL match | WCL recent reports + fight metadata | none | Missing match reduces confidence |

## 2. Performance

| Fact | Source | Collection method | Main risk |
|---|---|---|---|
| Selected-run parse percentile | WCL | fight/report rankings or character ranking payload tied to selected run | Aggregate rankings may lack fight IDs |
| Bracket-aware parse | WCL | rankings with keystone bracket when supported | Schema/shape can change |
| Key difficulty percentile | Raider.IO season cutoffs / run distribution | interpolate active-season regional distribution | season-cutoffs may be unavailable |
| Spec and role | Blizzard, Raider.IO, WCL | resolved identity and combatant info | spec changes between runs |

## 3. Survival

| Fact | Source | Required mapping |
|---|---|---|
| Death count | WCL Deaths events/table | player actor ID |
| Damage taken | WCL DamageTaken events/table | enemy ability and source actor |
| Avoidable damage | WCL DamageTaken + mechanic catalog | abilityID → avoidable/severity/dungeon/season |
| Personal defensive casts | WCL Casts/Buffs | abilityID → personal_defensive + cooldown |
| Self-healing | WCL Healing/Casts | abilityID → self_heal; effective vs overheal |
| Healing potion | WCL Casts/Healing | item/spell ID → health_potion |
| Max health | WCL combatant/resources or report data | actor snapshot | required for normalization |

## 4. Utility

| Fact | Source | Required mapping |
|---|---|---|
| Kick attempts | WCL Casts | active interrupt spell IDs by loadout/pet |
| Successful kicks | WCL Interrupts | source actor = player/pet attribution |
| Effective kick cooldown | ability catalog + talents/pet | spell ID, base cooldown, modifiers |
| CC targets | WCL Debuffs/Casts | CC ability IDs and hostile target instance IDs |
| Group support | WCL Casts/Buffs/Summons | external/group-support ability catalog |
| Defensive dispels | WCL Dispels | capability and dispel type |
| Offensive dispels/purges | WCL Dispels | capability and hostile target |

## 5. Experience

| Fact | Potential source | Feasibility |
|---|---|---|
| Same-character history through rename/transfer | WCL canonicalID | Supported identity continuity |
| Character season ratings | Raider.IO profile fields / Blizzard profile | Validate season coverage and retention |
| Public main/alt relationship | Raider.IO account-linked data | Must verify API field availability and licence terms |
| All characters on a player's account | user-authorized Blizzard profile flow | Requires authentication and user consent |
| Historical rank across expansions | provider archives | Raw score scales are not comparable; normalize per season |

## 6. Ability and mechanic catalogs

Create versioned data, not hard-coded conditionals:

```ts
type AbilityRule = {
  spellId: number;
  classSlug: string;
  specSlugs?: string[];
  categories: Array<
    | "interrupt"
    | "crowd_control"
    | "personal_defensive"
    | "self_heal"
    | "health_potion"
    | "group_support"
    | "defensive_dispel"
    | "offensive_dispel"
  >;
  baseCooldownMs?: number;
  petRequirement?: string;
  talentRequirements?: number[];
  cooldownModifiers?: Array<{ talentId: number; multiplier?: number; deltaMs?: number }>;
  validFromBuild?: string;
  validToBuild?: string;
};
```

```ts
type MechanicRule = {
  seasonSlug: string;
  dungeonSlug: string;
  npcId?: number;
  abilityId: number;
  avoidable: boolean;
  severity: "LOW" | "MEDIUM" | "HIGH" | "LETHAL";
  categories: string[];
  validFrom?: string;
  validTo?: string;
};
```

## 7. Required Wallidrixe smoke output

For each of the eight selected dungeons emit a sanitized row containing:

- canonical run fingerprint;
- dungeon and key level;
- duration and timed state;
- WCL report/fight fingerprints;
- parse percentile;
- key difficulty percentile inputs;
- deaths;
- total and avoidable damage;
- max-health normalization;
- defensive casts by catalog category;
- self-heal effective/overheal;
- health-potion casts;
- kick casts, successful interrupts, resolved cooldown;
- distinct CC target count;
- group-support casts;
- defensive/offensive dispels;
- missing data and rejection reasons.

Also emit aggregate coverage and provider point cost. Never expose raw report codes or unrelated roster data.

## 8. Research conclusions

- WCL exposes report event/table categories needed for Casts, DamageTaken, Deaths, Dispels, Healing and Interrupts.
- Avoidable damage and class-specific utility are not self-describing provider facts; they require versioned catalogs.
- WCL canonical character identity handles rename/transfer continuity, not arbitrary public account-wide alt discovery.
- Raider.IO provides character/run/season endpoints, but commercial use and public alt-link fields require explicit validation before product reliance.
