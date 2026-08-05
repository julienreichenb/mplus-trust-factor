# Offensive cooldown catalog (tooling)

Canonical package: **`@mplus/abilities`**.

Performance digests retain abilities tagged `PERFORMANCE_OFFENSIVE_COOLDOWN`.
Those entries live in the **same** canonical `AbilityRule` catalog as Utility and
Survival — there is no parallel production offensive catalog.

This document describes discovery, review, and validation tooling after a Retail
game patch.

## Ownership layers

| Layer | Path | Mutable by builder? |
|---|---|---|
| Source snapshots | `packages/abilities/generated/offensive/source-snapshots.json` | Yes (generated) |
| Candidate catalog | `packages/abilities/generated/offensive/candidates.json` | Yes (generated) |
| Review report | `packages/abilities/generated/offensive/review-report.json` | Yes (generated) |
| Reviewed canonical | `packages/abilities/src/catalog/classes/*.ts` + `shared/racials.ts` (dual-tag when needed) | **No** — human edit only |
| Coverage exemptions | `packages/abilities/src/offensive/tooling/exemptions.ts` | Human edit (tooling) |
| Validation report | `packages/abilities/generated/offensive/validation-report.json` | Yes (generated) |

Generated files must never be imported by production runtime as a catalog.

External adapters propose candidates. They never silently promote into production.

## Source adapters

| Adapter | Role | May classify offensive? |
|---|---|---|
| Blizzard Game Data | Playable class/spec matrix coverage seeds | No |
| Existing catalog | Preserve canonical keys + metadata | Yes (already reviewed) |
| Warcraft Logs | Observed unmatched spell IDs | No (validation only) |
| SimulationCraft | Optional SpellDataDump / APL advisory | No (do not vendor SimC sources; GPLv3) |

Do **not** scrape Wowhead. Wowhead URLs remain presentation-only via `external-metadata.ts`.

## Commands

```bash
# Deterministic candidate + review artifacts (does not touch reviewed sources)
pnpm catalog:build:offensive

# Coverage / activation / conflict gates (fails on missing spec coverage)
pnpm catalog:validate:offensive

# Structural catalog integrity (all dimensions)
pnpm abilities:validate
```

Optional stable timestamp for reproducible generated JSON:

```bash
# PowerShell
$env:OFFENSIVE_CATALOG_BUILD_TIME="2026-08-05T12:00:00.000Z"
pnpm catalog:build:offensive
```

## Catalog entry contract

Offensive cooldowns reuse the shared `AbilityRule` type:

- Categories: `OFFENSIVE_MAJOR` | `OFFENSIVE_MINOR` (mirror `DEFENSIVE_*`)
- Dimension tag: `PERFORMANCE_OFFENSIVE_COOLDOWN` (defaulted from those categories; dual-tag when valid)
- Shared activation metadata: `activationSpellIds` / `activationBuffIds` / `triggeredEffectIds`
- Shared correlation: `activationEventTypes` / `activationSource` / `charges`

Author with `performanceCooldownRule()` from `catalog/rule.ts`, or `rule()` with an
explicit `dimensionTags` array when the ability also belongs to Utility/Survival.

Do **not** add offensive-only production fields (`cooldownCategory`, `reviewStatus`,
`confidence`, per-rule `catalogVersion`). Candidate DTOs may use tooling-only
equivalents under `offensive/sources/types.ts`.

## Activation counting

Retained digest events are **not** cooldown uses.

Use `projectOffensiveActivations` (`@mplus/abilities`) or
`projectParticipantOffensiveActivations` (`@mplus/provider-warcraftlogs`) to report:

- `rawRetainedEventCount`
- `deduplicatedActivationCount`
- `canonicalCooldownCount`

Dedup is driven by metadata on the canonical ability entry: begincast+cast,
cast+applybuff, refresh/removebuff ignored as new uses, triggered IDs fold into
parent, pets attribute to owner, externals keep caster+recipient.

## Patch update workflow

1. Bump `packages/abilities/src/version.ts` game/season pins when the build changes.
2. Refresh Blizzard playable class/spec matrix if the roster changed (`classes-matrix.ts`).
3. Run `pnpm catalog:build:offensive` — inspect `review-report.json` for new candidates.
4. Optionally feed WCL unmatched summaries into `createWclObservedAdapter([...])` for a local build (still advisory).
5. Optionally drop a license-compatible SimC generated ID list beside the SimC adapter (empty by default).
6. Manually edit `catalog/classes/<class>.ts` or `shared/racials.ts` (or dual-tag an existing utility/survival rule).
7. Add/adjust `OFFENSIVE_COVERAGE_EXEMPTIONS` only with a documented reason.
8. Run `pnpm catalog:validate:offensive` and `pnpm --filter @mplus/abilities test`.
9. Rebuild digests from persisted evidence for the spike fight when DB evidence is available:
   `pnpm wcl:probe:offensive-one-fight` (no live WCL unless evidence is unreadable).
10. Confirm `providerCallsDuringReload === 0` and activation summaries per participant.

## Classification policy (summary)

**Include:** intentional major/minor offensive CDs, talent/hero talent CDs, offensive summons,
supported racials, explicit item on-use, offensive externals (caster+recipient).

**Exclude:** fillers, spenders/generators, passive procs, maintenance buffs, defensives,
CC/utility-only, automatic pet attacks, triggered damage already covered by a parent activation.

Do not classify solely from cooldown duration or spell-name heuristics.

## Spec coverage exemptions

Documented in `offensive/tooling/exemptions.ts`. Current exemptions:

- `demon-hunter/devourer` — Midnight-new / UNCERTAIN spell verification
- `shaman/restoration` — no intentional major personal damage CD in M+ toolkit
