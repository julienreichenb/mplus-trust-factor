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

1. Wave 4.3: RBAC sessions are primary for humans; `ADMIN_API_KEY` remains emergency fallback (`ADMIN_API_KEY_EMERGENCY_FALLBACK=true`).
2. Key usage is audited (`actorType=admin_key`).
3. Do not ship `VITE_ADMIN_API_KEY` in production bundles; use session cookies for SPA admin pages.
4. Later wave: set fallback false once operators have Battle.net admin role assignments.
