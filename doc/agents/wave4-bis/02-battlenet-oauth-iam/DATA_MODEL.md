# IAM Data Model

## Entities

| Model | Purpose |
|-------|---------|
| `User` | Application principal |
| `ExternalIdentity` | Provider subject binding (`battlenet` + subject) |
| `BattleNetAccount` | Linked Battle.net account; durable `providerAccountId`; encrypted tokens |
| `UserSession` | Server-side session (cookie is opaque id); survives Redis loss |
| `Role` / `Permission` / `RolePermission` / `UserRoleAssignment` | RBAC |
| `VerifiedCharacterOwnership` | Provider-backed account→character link |
| `AuditEvent` | Privileged action trail |
| `Entitlement` / `FeatureGrant` | Premium-ready grants (no billing) |

## Ownership rules

- Durable key: `(providerAccountId, blizzardCharacterId)` (+ region/realm for display).
- `verifiedAt` + `source` preserved; `status`: `CURRENT` | `HISTORICAL` | `STALE` | `REVOKED`.
- Rename/transfer: update name/realm; keep character id; move prior row to `HISTORICAL` when id leaves the account list.
- Never infer ownership from names alone.
- Private APIs only; public profiles never list alts.

## Migration notes

- Replaces unused stub `AccountCharacter` with `VerifiedCharacterOwnership`.
- Extends unused `BattleNetAccount` / `User` stubs.
- Characters and score tables are untouched; no score semantics change.
- Forward migration + seed for default roles/permissions.
