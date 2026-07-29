# Ability catalog (Wave 4.2 — Agent 32)

Canonical package: **`@mplus/abilities`**.

Do not duplicate ability catalogs under `@mplus/mechanics` (dungeon enemy mechanics only).

## Architecture

```text
packages/abilities/src/
  types.ts                 # taxonomy + AbilityRule + provenance
  version.ts               # game/season pins
  catalog/
    classes-matrix.ts      # Retail class/spec discovery matrix
    rule.ts                # rule() factory
    shared/                # consumables + optional racials
    classes/<class>.ts     # per-class Survival/Utility rules
  registry.ts              # getAbilityCatalog / resolveAbilityRule
  applicability.ts         # getApplicableAbilityCategories
  match.ts                 # scoring helpers (+ legacy category aliases)
  validation.ts            # structural validator
  coverage.ts              # coverage report
  admin-query.ts           # admin explorer payload
  external-metadata.ts     # Wowhead URL derivation (no scrape)
  cli/validate.ts
  cli/coverage.ts
```

Consumers:

| Consumer | Usage |
|---|---|
| Worker `combat-metrics` | `spellIdsForCategory` with legacy category aliases |
| Worker `refresh-pipeline` | `getAbilityCatalog({ classSlug, specSlug })` — **never** Warlock fallback |
| Admin API | `GET /api/v1/admin/ability-catalog` via `queryAdminAbilityCatalog` (dev-unprotected) |
| Admin UI | `/admin/ability-catalog` (dev-unprotected) |

## Taxonomy

```ts
type AbilityCategory =
  | "INTERRUPT" | "HARD_CC" | "SOFT_CC" | "DISPEL" | "PURGE"
  | "DEFENSIVE_MAJOR" | "DEFENSIVE_MINOR" | "IMMUNITY" | "SELF_HEAL"
  | "EXTERNAL_DEFENSIVE" | "GROUP_UTILITY" | "MOVEMENT_UTILITY"
  | "BATTLE_REZ" | "BLOODLUST" | "CONSUMABLE";
```

Legacy Wave 4 combat-metrics names (`interrupt`, `crowd_control`, `personal_defensive`, …) are mapped in `LEGACY_CATEGORY_MAP` so scoring formulas stay unchanged.

## Data sources

| Source | Role |
|---|---|
| Blizzard playable class / specialization indexes | Class/spec matrix (curated snapshot in `classes-matrix.ts`) |
| Repository fixture `warlock-demonology-tww-1` | Verified Warlock Demo + Healthstone / potion IDs |
| Curated Retail spell IDs | Class catalogs with `AbilityProvenance` |

Every rule carries:

```ts
interface AbilityProvenance {
  source: "BLIZZARD_API" | "CURATED_OVERRIDE" | "REPOSITORY_FIXTURE";
  sourceId?: string;
  verifiedAt: string;
  gameVersion: string;
  notes?: string;
  certainty?: "verified" | "uncertain" | "deprecated";
}
```

No community spell lists are treated as authoritative. Wowhead is **presentation only** (public spell URLs + optional tooltip script).

## Versioning

Current pin:

- `gameVersion`: `12.0.0` (Midnight)
- `seasonSlug`: `midnight-season-1`
- `catalogVersion`: `12.0.0/midnight-season-1`

Historical pin retained:

- `11.1.0` / `tww-season-2` — Warlock + shared consumables slice for reproducibility

`getCatalogByVersion(gameVersion)` returns the pinned catalog or `null`.

### Patch / season update procedure

1. Bump `CURRENT_CATALOG_VERSION` in `version.ts` (do not mutate historical pins).
2. Re-pull Blizzard playable class/spec indexes; update `RETAIL_CLASS_MATRIX` support states.
3. Diff spell IDs; add replacement aliases rather than overwriting semantic meaning of old IDs.
4. Mark uncertain entries with `supportCertainty: "uncertain"`.
5. Run `pnpm abilities:validate` and `pnpm abilities:coverage`.
6. Commit generated report artifacts notes + docs under `doc/wave4/`.

## Public APIs

```ts
getAbilityCatalog({ classSlug, specSlug, role, gameVersion })
getApplicableAbilityCategories({ classSlug, specSlug, role, knownTalentSpellIds, gameVersion })
resolveAbilityRule({ spellId, classSlug, specSlug })
```

Unsupported class/spec/version returns `{ ok: false, reason }` — never the Warlock catalog.

### Applicability semantics

- Spec without a category → `not_applicable` (no penalty expectation).
- Talent-only category without talent data → `uncertain`.
- Pet interrupts attributed to the player (`sourceOwnership: "PET"`).
- Replacement / aliases are one logical ability (`spellIds` + `aliases`).
- Battle Rez / Bloodlust are optional group expectations, not universal.
- Shared consumables live under `shared/` and are not copied into every class file.

## Validation commands

```bash
pnpm abilities:validate   # structural validation → packages/abilities/generated/validation-report.json
pnpm abilities:coverage   # coverage matrix → generated/coverage-report.{json,txt}
```

## Admin explorer

- Route: `/admin/ability-catalog`
- API: `GET /api/v1/admin/ability-catalog`
- Wowhead: public `spell=` links + optional `tooltips.js` progressive enhancement
- Icon fallback when CDN/metadata missing

**Development-only / currently unprotected.** Do not treat these surfaces as production-safe.

TODO before production:

- protect the admin route `/admin/ability-catalog`
- protect the admin API endpoint `GET /api/v1/admin/ability-catalog`
- integrate the future admin authentication/authorization system

## Integration notes for Agent 31

Agent 32 owns taxonomy data, registry, applicability, versioning, provenance, validation, coverage.

Agent 31 owns scoring algorithms, queue fan-in, dimension public state, confidence.

Adapter surface already provided:

- Prefer UPPERCASE `AbilityCategory`.
- Legacy lowercase categories still resolve via `expandScoringCategory`.
- Use `getApplicableAbilityCategories` before penalizing zero counts.
- Use `getAbilityCatalog` — empty/`ok:false` means unavailable metrics, not Warlock defaults.

If Agent 31 final interfaces differ, keep a thin adapter in the worker; do not rewrite catalog semantics.
