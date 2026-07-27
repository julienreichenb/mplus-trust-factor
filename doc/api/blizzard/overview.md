# Blizzard provider overview

Package: `@mplus/provider-blizzard`

## Modes

```ts
import { createBlizzardProvider } from "@mplus/provider-blizzard";

const fixture = createBlizzardProvider("fixture");
const live = createBlizzardProvider("live", {
  clientId: process.env.BLIZZARD_CLIENT_ID!,
  clientSecret: process.env.BLIZZARD_CLIENT_SECRET!,
  defaultRegion: "eu",
  defaultLocale: "en_GB",
  concurrency: 4,
});
```

- **fixture** (default for tests/CI): reads `tools/fixtures/blizzard/**`, zero network.
- **live**: OAuth client-credentials + regional REST. Requires credentials. Optional smoke: `pnpm --filter @mplus/provider-blizzard smoke:live`.

## Authentication

```http
POST https://oauth.battle.net/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
```

Token cached until `expires_in - 60s`. Concurrent refreshes share one in-flight promise. Secrets and access tokens must never be logged.

## Regions

| Key | API host | Namespaces |
|-----|----------|------------|
| `eu` (default) | `https://eu.api.blizzard.com` | `profile-eu`, `dynamic-eu`, `static-eu` |
| `us` | `https://us.api.blizzard.com` | `profile-us`, `dynamic-us`, `static-us` |
| `kr` | `https://kr.api.blizzard.com` | `profile-kr`, … |
| `tw` | `https://tw.api.blizzard.com` | `profile-tw`, … |

Locale default for EU: `en_GB`.

## Normalization

Returns shared DTOs from `@mplus/contracts` with provenance (`schemaVersion: blizzard-wow-profile-2026-07`). Character keys use `@mplus/domain` NFKC normalization. Display names preserved. No account-wide inference.

## Example request (secrets redacted)

```http
GET https://eu.api.blizzard.com/profile/wow/character/tarren-mill/examplecharacter?namespace=profile-eu&locale=en_GB
Authorization: Bearer <redacted>
```
