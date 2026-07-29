# Agent 38 — Phase 1 Auth Audit

**Base:** `integration/wave4.3` @ `6e70eff`  
**Branch:** `agent/wave4.3-battlenet-iam`  
**Coordination:** Experience (Agent 37) already merged into integration; no conflicting User/ownership Prisma changes. Utility shadow (Agent 35) is independent — this workstream does not depend on experimental Utility code.

## Verdict

MVP auth is a shared `x-admin-api-key`. There is no end-user login, session cookie, Battle.net authorization-code flow, RBAC, ownership verification, or audit trail. Prisma stubs (`User`, `BattleNetAccount`, `AccountCharacter`, `Entitlement`) exist but are unused at runtime.

## Current mechanisms

| Mechanism | Status | Location |
|-----------|--------|----------|
| Shared admin API key | Active | `apps/api/src/plugins/admin-auth.ts` |
| Soft admin check on refresh | Active | `isAdminRequest` → cooldown / negative-cache bypass |
| User sessions / cookies | Unused | `SESSION_SECRET`, `COOKIE_DOMAIN` in config only |
| Blizzard OAuth | Client credentials only | `packages/providers/blizzard` (public APIs) |
| Frontend route guards | None | `apps/web/src/routes.ts` |
| Premium | Global env flag | `PUBLIC_DETAILS_ALL` → serializer entitlements |

## Routes

### Protected by shared admin key

All under `apps/api/src/routes/admin.ts` auth hook: score-models CRUD/activate/backtest, character recalculate, mechanic-rules CRUD.

### Unprotected admin / sensitive

| Path | Risk |
|------|------|
| `GET /api/v1/admin/ability-catalog` | Explicitly outside auth hook |
| `GET /metrics` | Unauthenticated Prometheus |
| `GET /api/v1/jobs/:id` | Public if ID guessed |
| SPA `/admin/ability-catalog` | No guard |

### Public (no auth)

Health, meta, realms, character search/resolve/profile/refresh/history/runs/scores, comparisons, public score-models. Refresh accepts optional admin key for cooldown bypass.

## Prisma gaps vs IAM requirements

| Required | Current |
|----------|---------|
| User | Stub (`authProvider` + `externalSubject` + scalar `UserRole`) |
| ExternalIdentity | Missing |
| BattleNetAccount | Stub (hash + region; no provider account id / tokens) |
| UserSession | Missing |
| Role / Permission / UserRole | Scalar enum only |
| VerifiedCharacterOwnership | Closest: unused `AccountCharacter` |
| AuditEvent | Missing |
| Entitlement / FeatureGrant | Stub table + global env unlock |

## Refresh / WCL

- Manual cooldown: `MANUAL_REFRESH_COOLDOWN_SECONDS` (default 900).
- Admin key bypasses cooldown; **not audited**.
- WCL budget manager ignores premium/admin for global safety — preserve this.

## Secrets

- `ADMIN_API_KEY`, provider secrets server-side.
- `VITE_ADMIN_API_KEY` can embed admin secret in SPA if set.
- Redaction covers many secret keys; add `x-admin-api-key` header path.

## Privacy

Public character APIs are name-based. No verified ownership. Alt relationships must remain private after IAM lands.
