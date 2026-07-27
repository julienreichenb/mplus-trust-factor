# Error model

## Envelope

```json
{
  "error": {
    "code": "CHARACTER_NOT_FOUND",
    "message": "Character is confirmed not found upstream",
    "requestId": "uuid",
    "retryable": false,
    "details": {}
  }
}
```

`retryable` is optional for backward compatibility (Agent 5 contract CR).

## Common codes

| Code | HTTP | Retryable |
|------|------|-----------|
| `FST_ERR_VALIDATION` | 400 | no |
| `UNAUTHORIZED` | 401 | no |
| `CHARACTER_NOT_FOUND` | 404 | no |
| `JOB_NOT_FOUND` | 404 | no |
| `MODEL_VERSION_MISMATCH` | 409 | no |
| `REFRESH_COOLDOWN` | 429 | yes |
| `INTERNAL_ERROR` | 500 | no |

## Safety

- 5xx messages are generic (`Internal server error`); details omitted.
- Secrets and raw provider payloads are never included in envelopes or profile serializers.
- Pino redaction covers Authorization, cookies, and known secret field names.
