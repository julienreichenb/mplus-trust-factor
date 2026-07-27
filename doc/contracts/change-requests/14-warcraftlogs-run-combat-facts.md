# CR-14 — Promote WCL normalized combat facts and visibility to `@mplus/contracts`

## Requestor
Agent 14 (Warcraft Logs public live hardening)

## Motivation
`RunCombatFacts` and extended visibility states are stable enough for worker/scoring/API consumers, but remain provider-local. Wave 3 ownership forbids editing shared contracts in this branch; Agent 15/20 should apply this CR.

## Proposed additive types (non-breaking)

```typescript
export type WclVisibilityState =
  | "PUBLIC"
  | "HIDDEN"
  | "NO_PUBLIC_LOGS"
  | "PRIVATE_SKIPPED"
  | "UNAVAILABLE"
  | "RATE_LIMITED";

export interface RunCombatFactsCoverage {
  casts: boolean;
  interrupts: boolean;
  deaths: boolean;
  damageTaken: boolean;
  auras: boolean;
  dispels: boolean;
  healing: boolean;
  combatantInfo: boolean;
}

export interface RunCombatFactsLimitations {
  missingCategories: string[];
  truncatedPages: string[];
  notes: string[];
}

/** Stable normalized combat evidence — persist this; bound raw event retention. */
export interface RunCombatFacts {
  reportCode: string;
  fightId: number;
  revision: number;
  targetSourceId: number;
  // Event arrays + actor map: keep provider-local Map serialization note —
  // contracts should use Record/array forms for JSON persistence.
  coverage: RunCombatFactsCoverage;
  limitations: RunCombatFactsLimitations;
}
```

Also extend existing API `WclVisibilityState` in `packages/contracts/src/api.ts` with `UNAVAILABLE` | `RATE_LIMITED`.

## Optional provider interface additions

```typescript
interface WarcraftLogsProvider {
  discoverCharacterSummary?(...): Promise<ProviderResult<WclCharacterDiscoveryResult>>;
  fetchRunCombatFacts?(...): Promise<ProviderResult<RunCombatFacts>>;
}
```

## Migration notes

1. Move DTO shapes first; keep `WclActorMap` Maps as provider-internal or replace with serializable `actors: WclActorEntry[]`.
2. Re-export from `@mplus/provider-warcraftlogs` for one release to avoid breaking workers.
3. Update profile serializer / score fusion to treat `HIDDEN` / `NO_PUBLIC_LOGS` / `PRIVATE_SKIPPED` / `UNAVAILABLE` / `RATE_LIMITED` as coverage-only (never direct score penalties).

## Env formalization (Agent 11)

```text
WCL_MPLUS_ZONE_ID=45
WCL_MPLUS_ZONE_EXPIRES_AT=2026-12-01T00:00:00.000Z
```

## Status
**Applied by Agent 15** — shared DTOs live in `packages/contracts/src/warcraftlogs.ts`;
`CharacterProfileResponse.wclVisibility` accepts `UNAVAILABLE` | `RATE_LIMITED`;
provider package re-exports the contract visibility/coverage types while keeping full
event-bearing `RunCombatFacts` provider-local.

## Related
- [02-warcraftlogs-extended-provider.md](./02-warcraftlogs-extended-provider.md)
- Provider implementation: `packages/providers/warcraftlogs/src/types.ts`
