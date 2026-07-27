# Contract/config change request — Agent 5

## Topic

Add `PUBLIC_DETAILS_ALL` environment flag for MVP entitlement serialization.

## Motivation

Agent 5 must support server-side entitlement readiness: all details public initially, with a switch to omit premium fields later.

## Proposed change

```ts
PUBLIC_DETAILS_ALL: booleanFromString.default(true)
```

Default `true` preserves current MVP behavior.

## Compatibility

Additive env var with default; no breaking change.

## Status

Applied by Agent 5.
