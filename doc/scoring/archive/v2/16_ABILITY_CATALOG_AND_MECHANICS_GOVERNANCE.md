---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Ability catalog and mechanic governance

## 1. Purpose

Survival, Utility, and Phase 2 Performance depend on knowing what a specialization could use and what an observed spell means. A partial or incorrect catalog must lower confidence, not create false penalties.

## 2. Ability entry

```ts
interface AbilityCatalogEntryV2 {
  canonicalKey: string;
  spellIds: number[];
  classSlug: string;
  specSlugs: string[];
  roles: string[];
  category: string;
  semantic: string;
  targetType: string;
  cooldownMs: number | null;
  charges: number | null;
  durationMs: number | null;
  talentRequirements: TalentRequirement[];
  replacementKeys: string[];
  ownerAttribution: "PLAYER" | "PET" | "EITHER";
  availabilityModel: string;
  scoringModes: string[];
  source: string;
  verifiedAt: string;
  version: string;
  notes: string[];
}
```

## 3. Categories

### Performance Phase 2

- offensive major;
- offensive minor;
- burst window;
- resource cooldown;
- reset/extension ability.

### Survival

- defensive major;
- defensive minor;
- immunity;
- absorb;
- max-health increase;
- self-heal;
- emergency consumable.

### Utility

- interrupt;
- stun;
- disorient/incapacitate;
- silence;
- knock/grip;
- dispel/purge;
- external defensive;
- group defensive;
- group movement;
- portal/gateway;
- strategic/emergency support.

One spell may have multiple semantics but must avoid duplicate scoring.

## 4. Talent and replacement resolution

Availability is resolved from:

- Blizzard talent snapshot;
- WCL CombatantInfo;
- known spec baseline;
- replacement relationships.

States:

```text
AVAILABLE_CONFIRMED
AVAILABLE_INFERRED
NOT_TALENTED_CONFIRMED
REPLACED
UNKNOWN
```

Only confirmed/inferred available abilities can create missed-opportunity penalties. `UNKNOWN` lowers confidence.

## 5. Cooldown modeling

Catalog records base cooldown, charges, duration, and known modifiers. Phase 2 additionally requires:

- haste scaling;
- talent reductions;
- proc resets;
- charge regeneration;
- cooldown extension;
- fight downtime;
- death/resurrection resets where applicable.

Do not compute expected uses from total fight duration without availability simulation.

## 6. Mechanic catalog

```ts
interface MechanicRuleV2 {
  seasonId: string;
  dungeonId: string;
  npcId: number | null;
  spellId: number;
  ruleType: string;
  priority: number;
  interruptible: boolean | null;
  ccEligible: boolean | null;
  mandatoryDamage: boolean;
  avoidableDamage: boolean | null;
  applicableRoles: string[];
  responseAbilityCategories: string[];
  timingWindowMs: number | null;
  source: string;
  version: string;
  confidence: number;
}
```

## 7. Coverage

Compute per run/spec:

- applicable ability count;
- known availability share;
- observed spell mapping share;
- mechanic mapping share;
- unknown spell/action count.

Catalog coverage affects confidence and activation of Phase 2/3 features.

## 8. Versioning

Catalog entries are immutable versions. A patch/hotfix creates a new catalog version or effective-date binding.

A fact set records the exact catalog version used.

## 9. Validation

Automated checks:

- unique canonical keys;
- no duplicate spell IDs with conflicting active semantics;
- cooldown/charge bounds;
- valid class/spec references;
- replacement graph acyclic;
- all scoring categories recognized;
- talent requirement references valid;
- test fixtures for each class/spec;
- observed unknown spell report.

## 10. Workflow

1. discover from Blizzard/static data and WCL probes;
2. create proposed entry;
3. verify against logs and class knowledge;
4. add fixtures;
5. activate for shadow;
6. audit coverage;
7. activate scoring semantic;
8. monitor unknowns/regressions.

## 11. Seasonal mechanics

Mechanic rules are season/dungeon/version scoped. They never live as ad hoc code branches in dimension calculators.
