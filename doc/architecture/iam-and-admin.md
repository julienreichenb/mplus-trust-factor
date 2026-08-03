# IAM and admin

## Identity

- Authorization key: immutable internal **user ID** or Battle.net OAuth **subject**.
- BattleTag / email / character name are display or search attributes only — never grant keys.

## First-admin bootstrap

There is **no HTTP bootstrap endpoint**. The first human administrator authenticates with their own Battle.net account, then is promoted via CLI.

CLI: `apps/api/src/iam/grant-admin.cli.ts` (`pnpm iam:grant-admin`).

Accepts exactly one of:

- `--user-id <uuid>`
- `--battlenet-subject <provider-subject>`

Rejects BattleTag, character name, email, and fuzzy matching.

### Procedure (test / ops)

1. Ensure Blizzard OAuth credentials and callback allowlist are configured.
2. Sign in once via Battle.net OAuth.
3. Retrieve immutable ids (`GET /api/v1/auth/me` → `user.id`; `GET /api/v1/me/battlenet` → provider account id).
4. Promote exactly that identity:

```bash
pnpm iam:grant-admin -- --user-id <uuid>
# or
pnpm iam:grant-admin -- --battlenet-subject <provider-subject>
```

The command fails if the identity does not exist or is ambiguous; is idempotent; writes an audit event; prints `userId` and Battle.net subject.

5. Re-sign-in if needed so role assignments reload; confirm admin permissions on `/api/v1/auth/me`.
6. Disable emergency shared key (`ADMIN_API_KEY_EMERGENCY_FALLBACK=false`) and restart the API.

Bootstrap must stay external to the protected admin UI. Hiding nav is **not** security — routes stay server-protected.

## Ownership region (MVP)

Ownership sync is **EU-only** (`BATTLENET_OWNERSHIP_SYNC_REGION=eu`). Unsupported regions are rejected with `OWNERSHIP_REGION_UNSUPPORTED`.

## Environment notes

- Test already contains the user’s Battle.net login.
- Local may not yet.

## Related surfaces

- Admin score models UI: `apps/web/src/pages/AdminModelsPage.vue`
- Permission prehandlers + audit events in API
- Prisma role/permission tables
