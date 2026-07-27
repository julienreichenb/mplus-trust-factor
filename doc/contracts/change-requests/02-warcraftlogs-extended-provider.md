# Warcraft Logs provider — extended analysis API (additive)

## Requestor
Agent 2 (Warcraft Logs integration)

## Motivation
The baseline `WarcraftLogsProvider` contract exposes only:
- `discoverCharacterRuns` → `MythicRunDTO[]`
- `getReportFightDetails` → `unknown`

Agent 2 implements rich normalized DTOs (`WclCharacterDiscoveryResult`, `RunCombatFacts`, etc.) exported from `@mplus/provider-warcraftlogs`. Agent 5 (worker) will need typed access without casting.

## Proposed additive change
Add optional methods to `WarcraftLogsProvider` (non-breaking — existing stubs remain valid):

```typescript
interface WarcraftLogsProvider {
  // existing methods unchanged
  discoverCharacterSummary?(...): Promise<ProviderResult<WclCharacterDiscoveryResult>>;
  fetchRunCombatFacts?(...): Promise<ProviderResult<RunCombatFacts>>;
}
```

Alternatively, import DTOs from `@mplus/provider-warcraftlogs` in worker code without moving them to `@mplus/contracts` until integration.

## Recommendation
**Defer contract move** until Agent 10 integration. Worker imports provider package types directly. No breaking changes required for Wave 1.

## Status
Documented — no `@mplus/contracts` edit in Agent 2 branch.
