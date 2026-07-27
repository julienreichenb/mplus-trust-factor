# Fixture governance

## Location

- Manifest: `tools/fixtures/manifest.json`
- Versioned payloads: `tools/fixtures/providers/<provider>/v1/`
- Scoring cohort: `tools/fixtures/scoring/`

## Rules

1. **Synthetic or sanitized only** — no real tokens, cookies, IPs, emails, private report codes, or unrelated player data.
2. **Version by provider/schema** — bump `v1` → `v2` when boundary shapes change.
3. **Manifest entry required** — every fixture file must be listed with `origin`, `capturedAt`, and `description`.
4. **CI validation** — `tests/contract/provider-and-openapi.test.ts` parses fixtures against Zod schemas and runs `assertFixtureSanitized`.
5. **Schema drift process** — when a provider agent updates shapes:
   - Add/update fixture under new version path.
   - Update Zod schema in `packages/test-utils/src/provider-schemas.ts`.
   - Update manifest.
   - If shared contracts change, open `doc/contracts/change-requests/<agent>-<topic>.md`.

## Sanitization checks

Forbidden patterns in fixture text:

- Bearer tokens, `client_secret`, passwords
- Email addresses
- Private IPv4 literals

## Expert cohort

`expert-cohort-v1.json` provides a representative set for scoring golden/invariant tests without production scores.
