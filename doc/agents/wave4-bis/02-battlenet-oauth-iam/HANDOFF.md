# Agent 38 Handoff — Battle.net OAuth / IAM

**Branch:** `agent/wave4.3-battlenet-iam`  
**HEAD:** see `git rev-parse HEAD` after merge  
**Base:** `integration/wave4.3` including Utility production-safe shadow (`44eaf27`) — re-merged before final validation  
**Do not merge this branch into integration yourself** — leave merge to the integrator.

## Deliverables

| Artifact | Path |
|----------|------|
| Audit | `AUDIT.md` |
| Official OAuth summary | `OAUTH_FLOW.md` |
| Data model | `DATA_MODEL.md` |
| Threat model | `THREAT_MODEL.md` |
| RBAC + admin-key plan | `RBAC_MATRIX.md` |
| Entitlements | `ENTITLEMENTS.md` |
| Migration | `packages/database/prisma/migrations/20260729180000_battlenet_iam/` |

## Implementation summary

- Authorization-code OAuth with `state`, PKCE S256, allowlisted callbacks, HttpOnly session cookies (`Secure` in production/staging).
- Provider tokens encrypted at rest (AES-256-GCM); never returned to clients.
- Verified ownership from `/profile/user/wow`; private `/api/v1/me/*` APIs; unlink revokes tokens + CURRENT ownership.
- RBAC roles/permissions seeded on boot; admin routes permission-gated; `ADMIN_API_KEY` emergency fallback (audited).
- Refresh cooldown bypass requires permission or emergency key; audited; WCL global safety unchanged.
- UI: `/auth/signin`, `/auth/error`, `/account`, `/access-denied`; admin nav gated by permissions.

## Validation

- `pnpm db:migrate` — applied `20260729180000_battlenet_iam`
- `pnpm build` — pass
- IAM + admin + security tests — pass

## Remaining IAM blockers

1. Live Battle.net client credentials + registered redirect URIs required for real OAuth (fixture/mocks cover automated tests).
2. Assign first human admin via `UserRoleAssignment` (role `admin`) before disabling `ADMIN_API_KEY_EMERGENCY_FALLBACK`.
3. SPA still may use `VITE_ADMIN_API_KEY` for legacy admin models page — migrate fully to session auth before production.
4. Multi-region ownership sync currently uses `BLIZZARD_DEFAULT_REGION` for `/profile/user/wow`; extend to iterate account regions if CN/multi-host is required.
5. `/metrics` remains unauthenticated (ops decision).
6. Do not depend on experimental Utility scoring — only production-safe shadow from integration merge.

## Privacy / scoring

- Alts never exposed on public profile serializers.
- No scoring semantics or weight changes.
- No billing.
