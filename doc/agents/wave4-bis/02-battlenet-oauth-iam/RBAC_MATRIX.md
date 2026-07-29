# RBAC Matrix

| Permission | User | Admin | Emergency admin key |
|------------|------|-------|---------------------|
| `profile.refresh.request` | ✓ | ✓ | ✓ (implicit via routes) |
| `profile.refresh.force` | | ✓ | ✓ |
| `profile.refresh.cooldown_bypass` | | ✓ | ✓ (audited) |
| `provider.diagnostics.read` | | ✓ | ✓ |
| `score.candidate.read` | | ✓ | ✓ |
| `score.recalculate` | | ✓ | ✓ |
| `admin.users.read` | | ✓ | ✓ |
| `admin.users.manage` | | ✓ | ✓ |
| `admin.jobs.manage` | | ✓ | ✓ |
| `admin.settings.manage` | | ✓ | ✓ |
| `admin.score_models.manage` | | ✓ | ✓ |
| `admin.mechanic_rules.manage` | | ✓ | ✓ |
| `admin.ability_catalog.read` | | ✓ | ✓ |

Owner cooldown bypass is opt-in via `OWNER_REFRESH_COOLDOWN_BYPASS` and never bypasses WCL global safety.

## Admin key migration

1. Wave 4.3: RBAC sessions are primary. `ADMIN_API_KEY_EMERGENCY_FALLBACK` defaults to **false**.
2. Local `.env.example` may set fallback `true` for development; staging/prod examples keep `false`.
3. Key usage is audited (`actorType=admin_key`). SPA must never send the key.
4. After `pnpm iam:grant-admin`, set `ADMIN_API_KEY_EMERGENCY_FALLBACK=false` and restart.
5. Never ship admin secrets in frontend bundles (`VITE_ADMIN_API_KEY` removed).
