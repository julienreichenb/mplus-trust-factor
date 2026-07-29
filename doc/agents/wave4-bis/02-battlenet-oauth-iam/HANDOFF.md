# Agent 38 Handoff — Battle.net OAuth / IAM (corrective)

**Branch:** `agent/wave4.3-battlenet-iam`  
**Implementation commit:** `e200756`  
**Corrective commit:** `b17791b`  

## Bootstrap (you = first admin)

1. Sign in once via Battle.net OAuth.
2. Read `user.id` from `GET /api/v1/auth/me` (or `providerAccountId` from `GET /api/v1/me/battlenet`).
3. Run:

```bash
pnpm iam:grant-admin -- --user-id <uuid>
# or
pnpm iam:grant-admin -- --battlenet-subject <provider-subject>
```

4. Verify admin permissions on `/api/v1/auth/me`.
5. Set `ADMIN_API_KEY_EMERGENCY_FALLBACK=false` and restart.

Details: `FIRST_ADMIN_BOOTSTRAP.md`, `ENV_MATRIX.md`.

## Corrective scope

- Removed all SPA `VITE_ADMIN_API_KEY` / browser admin-key usage; session cookies only.
- Frontend secret-bake tests.
- First-admin CLI (immutable ids only).
- Emergency key default **false**; startup warn when enabled; audited.
- Test/prod env examples completed for OAuth/session/cookies.
- Caddy returns 404 for public `/metrics`; private network scrape only.
- Ownership sync documented and enforced as **EU-only**.

## Remaining deployment-only blockers

1. Register real Blizzard OAuth client + redirect URI for test/prod domains.
2. Fill secrets via `ops:generate-secrets` (never commit).
3. Run first OAuth login + `iam:grant-admin` on the target environment.
4. Confirm Prometheus scrape job targets private API DNS name, not the public hostname.
