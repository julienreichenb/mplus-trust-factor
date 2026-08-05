# Scoring V2 canonical extraction (production)

Canonical ability catalog, shared capability evidence, and dimension extractors that scoring must eventually consume instead of raw WCL event pages.

## Production modules

| Concern | Location |
|---------|----------|
| Ability rules + Retail matrix + activation projectors | `@mplus/abilities` (`catalog/`, `offensive/activation.ts`, `survival/activation.ts`) |
| Capability evidence acquisition / persist / reload | `packages/providers/warcraftlogs/src/evidence/capability/` |
| Event field normalization | `packages/providers/warcraftlogs/src/normalize/wcl-event-normalizer.ts` |
| Participant resolution | `packages/providers/warcraftlogs/src/extractors/participants/` |
| Offensive / Utility / Survival extractors | `packages/providers/warcraftlogs/src/extractors/{offensive,utility,survival}/` |
| Contracts | `capability-evidence-v1`, `utility-action-timeline-v1`, `survival-action-timeline-v1` |
| PostgreSQL artifact payloads | Existing `PostgresArtifactStore` on feature lineage (do not duplicate) |

## Developer probes (not scoring runtime)

- `pnpm wcl:probe:offensive-one-fight`
- `pnpm wcl:probe:utility-one-fight`
- `pnpm wcl:probe:survival-one-fight`

These reload persisted `pg://` evidence with zero provider calls when local evidence is present. They are not exported as production orchestration entrypoints.

## Explicitly out of production path

- Combat-digest prototype
- Live one-fight reacquisition / combat-digest `--live` acquisition
- Probe-only timeline persist helpers under `apps/worker`

## Related

- [WCL capability evidence contract](wcl-capability-evidence-contract.md)
- [Extraction integration review](scoring-v2-extraction-integration-review.md)
- [Scoring V2 docs](../scoring/v2/00_README.md)
