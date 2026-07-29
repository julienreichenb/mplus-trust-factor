# First-admin bootstrap (test / ops)

The first human administrator authenticates with **their own Battle.net account**.
There is **no HTTP bootstrap endpoint**.

## Procedure (test environment)

1. Ensure test env has Blizzard OAuth credentials and callback allowlist
   (`BATTLENET_OAUTH_CALLBACK_URLS=https://test.trust.example.com/api/v1/auth/battlenet/callback`).
2. Open `https://test.trust.example.com/auth/signin` and complete Battle.net OAuth once.
3. While signed in, retrieve immutable ids (browser network tab or curl with session cookie):

```bash
curl -sS -b cookies.txt https://test.trust.example.com/api/v1/auth/me
# → user.id  (local UUID)

curl -sS -b cookies.txt https://test.trust.example.com/api/v1/me/battlenet
# → account.providerAccountId  (Battle.net subject / provider account id)
```

SQL alternative (server-side only):

```sql
SELECT id, display_name, external_subject FROM users ORDER BY created_at DESC LIMIT 5;
SELECT subject FROM external_identities WHERE provider = 'battlenet';
SELECT provider_account_id FROM battlenet_accounts;
```

4. On the API host (with `DATABASE_URL` / `.env` loaded), promote **exactly** that identity:

```bash
pnpm iam:grant-admin -- --user-id <uuid>

# or
pnpm iam:grant-admin -- --battlenet-subject <provider-subject>
```

The command:

- fails if the identity does not exist
- fails if more than one row matches
- is idempotent
- writes an audit event (`iam.grant_admin` / `iam.grant_admin.idempotent`)
- prints `userId` and Battle.net subject/account id
- rejects BattleTag, character name, email, and fuzzy matching (those flags are not accepted)

5. Verify admin permissions:

```bash
curl -sS -b cookies.txt https://test.trust.example.com/api/v1/auth/me
# permissions must include admin.score_models.manage (and other admin.*)
```

Re-sign-in if the session was created before promotion so role assignments reload.

6. Disable the emergency shared key:

```env
ADMIN_API_KEY_EMERGENCY_FALLBACK=false
```

Restart the API. Confirm startup no longer warns about emergency fallback.

## Ownership region (MVP)

Ownership sync is **EU-only** (`BATTLENET_OWNERSHIP_SYNC_REGION=eu`).
Unsupported regions are rejected with `OWNERSHIP_REGION_UNSUPPORTED`.
This is intentional for Wave 4.3 — not multi-region support.
