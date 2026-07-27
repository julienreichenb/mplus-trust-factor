# Frontend API contract usage

## Client

- Entry: `apps/web/src/api/client.ts`
- Live HTTP: `live-client.ts` (paths aligned with Agent 5 CRs)
- Mock: `mock/client.ts` + `mock/fixtures.ts`

## Contract types used

From `@mplus/contracts`:

- `MetaResponse`
- `CharacterIdentityInput`
- `ScoreSnapshotDTO` / `DimensionScoreDTO` / `RedFlagDTO` / `Grade`
- `CharacterComparisonRequest` / `CharacterComparisonResponse`
- `RefreshStatusResponse` / `JobStatusDTO`
- `AdminScoreModelDTO`
- `ApiErrorEnvelope` (live errors)

## View enrichments (interim)

`CharacterProfileView` extends profile response with class/spec/role/ilvl, run summaries, equipment/talents, season summary, entitlements, warnings, `raiderIoUsed`.

See:

- `doc/contracts/change-requests/06-profile-enrichment.md`
- `doc/contracts/change-requests/06-admin-model-ops.md`
- `doc/contracts/change-requests/06-realms-autocomplete.md`

## Rules

- Browser never holds provider secrets.
- Browser never recomputes Trust Factor formulas.
- Mock mode is the default for local/CI independence.
