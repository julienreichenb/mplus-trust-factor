# IAM environment variable matrix

| Variable | Purpose | Local default | Test (`test.trust.example.com`) | Prod |
|----------|---------|---------------|---------------------------------|------|
| `ADMIN_API_KEY` | Server-only emergency key | required | required placeholder | required placeholder |
| `ADMIN_API_KEY_EMERGENCY_FALLBACK` | Accept `x-admin-api-key` as RBAC bypass | `true` in `.env.example` | `false` | `false` |
| `SESSION_SECRET` | Session/OAuth-state crypto (≥32) | local placeholder | placeholder | placeholder |
| `PROVIDER_TOKEN_ENCRYPTION_SECRET` | Provider token AES key (optional; falls back to `SESSION_SECRET`) | unset | dedicated placeholder | dedicated placeholder |
| `SESSION_COOKIE_NAME` | HttpOnly session cookie | `mplus_session` | same | same |
| `SESSION_TTL_SECONDS` | Session lifetime | `2592000` | same | same |
| `COOKIE_DOMAIN` | Cookie domain | `localhost` | `test.trust.example.com` | prod domain |
| `TRUST_PROXY` | Honor `X-Forwarded-*` | `false` | `true` | `true` |
| `WEB_ORIGIN` | CORS allowlist (SPA origin) | `http://localhost:5173` | `https://test.trust.example.com` | prod URL |
| `PUBLIC_BASE_URL` | Public API base | `http://localhost:3000` | `https://test.trust.example.com` | prod URL |
| `BLIZZARD_CLIENT_ID` / `SECRET` | OAuth + Game Data | empty | test client | prod client |
| `BATTLENET_OAUTH_CALLBACK_URLS` | Callback allowlist (exact URLs) | localhost callback | `https://test.trust.example.com/api/v1/auth/battlenet/callback` | prod callback |
| `BATTLENET_OAUTH_SCOPES` | OAuth scopes | `openid wow.profile` | same | same |
| `BATTLENET_OWNERSHIP_SYNC_REGION` | Ownership sync region | `eu` (MVP only) | `eu` | `eu` |
| `OWNER_REFRESH_COOLDOWN_BYPASS` | Owner cooldown privilege | `false` | `false` | `false` |

**Secure cookies:** enabled when `NODE_ENV=production` or `APP_ENV` is `production`/`staging`.

**Never set** `VITE_ADMIN_API_KEY` — SPA uses HttpOnly session cookies + RBAC only.

**`/metrics`:** not routed on the public Caddy edge (404). Scrape via private Docker network.
