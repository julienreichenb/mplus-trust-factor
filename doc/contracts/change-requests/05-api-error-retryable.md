# Contract change request — Agent 5

## Topic

Add optional `retryable` to `ApiErrorEnvelope`.

## Motivation

Agent 5 acceptance requires a standard error envelope with `retryable` for client backoff decisions. The Agent 0 envelope lacked this field.

## Proposed change

```ts
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable?: boolean;
    details?: unknown;
  };
}
```

## Compatibility

Additive optional field. Existing clients ignore it.

## Status

Applied by Agent 5 (backward compatible).
