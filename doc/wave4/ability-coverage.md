# Ability catalog coverage (Wave 4.2 — Agent 32)

Generated from `RETAIL_CLASS_MATRIX` + registered rules. Refresh with:

```bash
pnpm abilities:coverage
```

Artifacts:

- `packages/abilities/generated/coverage-report.txt`
- `packages/abilities/generated/coverage-report.json`

## Current pin

| Field | Value |
|---|---|
| Game version | `12.0.0` (Midnight) |
| Season | `midnight-season-1` |
| Generated | `2026-07-28` |
| Source snapshot | `retail-midnight-s1-curated-2026-07-28` |
| Canonical rules | **189** |
| Spell IDs | **194** |
| Aliases | **4** |
| Talent-dependent | 33 |
| Pet-dependent | 4 |
| Uncertain rules | 5 |
| Validation | **PASS** (0 errors, 5 warnings) |

## Matrix

13 classes · 40 specializations (includes Demon Hunter **Devourer**).

| Class | Support | Specs |
|---|---|---|
| Death Knight | SUPPORTED | blood (T), frost, unholy |
| Demon Hunter | PARTIAL | havoc, vengeance (T), devourer (**UNCERTAIN**) |
| Druid | SUPPORTED | balance, feral, guardian (T), restoration (H) |
| Evoker | SUPPORTED | devastation, preservation (H), augmentation |
| Hunter | SUPPORTED | beast-mastery, marksmanship, survival |
| Mage | SUPPORTED | arcane, fire, frost |
| Monk | SUPPORTED | brewmaster (T), mistweaver (H), windwalker |
| Paladin | SUPPORTED | holy (H), protection (T), retribution |
| Priest | SUPPORTED | discipline (H), holy (H), shadow |
| Rogue | SUPPORTED | assassination, outlaw, subtlety |
| Shaman | SUPPORTED | elemental, enhancement, restoration (H) |
| Warlock | SUPPORTED | affliction, demonology, destruction |
| Warrior | SUPPORTED | arms, fury, protection (T) |

## Uncertain / partial areas

| Area | State | Notes |
|---|---|---|
| Demon Hunter Devourer | UNCERTAIN | Class-shared utilities only; Devourer-specific spell IDs not invented |
| Warlock Optical Blast | uncertain | Observer / Command Demon interrupt alias drift |
| Warlock Grimoire of Sacrifice | uncertain | Choice-node utility relevance |
| Shared racials | uncertain | Optional; scorers must opt in (`includeRacials`) |
| Healing potion IDs | curated | Re-verify on each patch |

## Talent limitations

- Talent / choice-node rules use `availability: "TALENT" | "CHOICE_NODE"`.
- Without `knownTalentSpellIds`, applicability returns `uncertain` for talent-only categories.
- Pet-dependent rules remain applicable (loadout assumed unless scorer narrows further).

## Pet attribution

- `sourceOwnership: "PET" | "GUARDIAN" | "ANY_OWNED"` — combat attribution uses player + pet source IDs.
- Warlock Spell Lock / Axe Toss / Singe Magic are the primary pet fixtures.

## Remaining gaps

- Live Blizzard Game Data spell pull automation (credentials optional; matrix currently curated).
- Guardian ownership examples sparse (DK/Druid guardians may be expanded later).
- Full Midnight Apex talent modifiers not modeled (`cooldownModifiers` reserved for later wave).
- Icon names not stored — admin UI uses Wowhead links + local fallbacks.

## Validation

```bash
pnpm abilities:validate
pnpm abilities:coverage
pnpm test
```
