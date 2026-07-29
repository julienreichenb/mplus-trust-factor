# Official Battle.net OAuth Flow Summary

**Sources (official / Blizzard-maintained):**

- [Using OAuth](https://develop.battle.net/documentation/guides/using-oauth) — Battle.net Developer Portal
- [Getting Started](https://develop.battle.net/documentation/guides/getting-started)
- [Account Profile Summary](https://develop.battle.net/documentation/world-of-warcraft/profile-apis/account-profile-summary) — `/profile/user/wow`
- [Blizzard oauth-client-sample](https://github.com/Blizzard/oauth-client-sample)
- Blizzard Developer Forums staff clarifications on authorization-code vs client-credentials

Do not treat third-party tutorials as authoritative for security-critical behavior.

## Authorization flow

1. Redirect the user to Battle.net authorize with `response_type=code`.
2. User authenticates and consents on Blizzard servers.
3. Battle.net redirects to a **registered** `redirect_uri` with `code` and echoed `state`.
4. Backend exchanges `code` at the token endpoint with `grant_type=authorization_code` (server-side; client secret never in browser).
5. Use the user access token (Bearer) for protected Profile APIs.
6. Issue an application session cookie; keep provider tokens server-side only.

### Endpoints (global host)

| Purpose | URL |
|---------|-----|
| Authorize | `https://oauth.battle.net/authorize` |
| Token | `https://oauth.battle.net/token` |
| Userinfo | `https://oauth.battle.net/userinfo` (or `/oauth/userinfo`) |

China uses `oauth.battlenet.com.cn` (out of scope for EU/US/KR/TW unless explicitly enabled).

Region-specific hosts (`{region}.battle.net/oauth/...`) appear in older forum guidance; the developer portal samples use the global `oauth.battle.net` host. This implementation uses the global host and selects WoW API hosts by character region.

## Scopes

| Scope | Use |
|-------|-----|
| `openid` | Subject / account identity via userinfo |
| `wow.profile` | Account character list and protected WoW profile endpoints |

Optional game scopes (`sc2.profile`, `d3.profile`) are not required.

## Account / profile APIs for ownership

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /userinfo` | User access token | Durable account `id` / `sub`, BattleTag display |
| `GET /profile/user/wow` | User token + `wow.profile` | Account → wow_accounts → characters (id, realm, name, playable class/race, level, faction) |

Character ownership **must** come from `/profile/user/wow` (or protected-character endpoints), never from name-only public lookups.

Public Game Data / Character Profile APIs use **client credentials** and do **not** prove ownership.

## Region behavior

- OAuth authorize/token: global `oauth.battle.net` for non-CN regions.
- Profile API host: `{eu|us|kr|tw}.api.blizzard.com` with matching `namespace=profile-{region}`.
- A single Battle.net account can own characters across WoW accounts/regions returned by `/profile/user/wow`.

## Tokens

| Kind | Lifetime / notes |
|------|------------------|
| Authorization code | Short-lived; single use; exchange promptly |
| Access token | Official guidance: ~24h (`expires_in`); cannot be extended arbitrarily |
| Refresh token | Returned by authorization-code exchange in Blizzard OAuth; use `grant_type=refresh_token` to renew without re-consent when present |
| Client-credentials token | Separate; for public APIs only — never for ownership |

Store provider tokens encrypted at rest. Never send them to the browser or logs.

## Identifiers

| Identifier | Role |
|------------|------|
| Battle.net account `id` / OAuth `sub` | Durable provider account ID (not display name) |
| BattleTag | Display only; may change; store hashed for privacy where needed |
| Character `id` | Durable Blizzard character id within a realm |
| Realm slug + name | Presentational / lookup aids; insufficient alone for ownership |

## Storage / privacy terms (implementation constraints)

- Account-to-character links are **private by default**.
- Proving ownership of multiple characters does **not** authorize public alt disclosure.
- Profile data is personal; fetch only authorized account/profile data after consent.
- Unlink revokes future private sync and clears stored provider tokens.

## Outage behavior

| Failure | App behavior |
|---------|--------------|
| Authorize / login page down | Sign-in unavailable; existing sessions remain valid until expiry |
| Token exchange fails | Callback error page; no partial session |
| `/userinfo` or `/profile/user/wow` fails after login | Session may be created from prior link; ownership refresh fails with retryable error; do not invent ownership |
| Token expired + refresh fails | Require re-link; mark ownership sync stale; do not delete historical verified rows immediately |
| Rate limit / 429 | Back off; audit event; respect global provider budgets |

Existing public Trust Scores continue to serve from PostgreSQL without Battle.net user OAuth.
