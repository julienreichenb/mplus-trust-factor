# Agent 38 Prompt — Battle.net OAuth, Character Ownership and IAM

You are responsible for implementing Battle.net OAuth and a production-grade IAM foundation for M+ Trust Factor.

Work on:

- branch: `agent/wave4.3-battlenet-iam`
- base: `integration/wave4.3`

Coordinate Prisma changes with the Experience workstream before implementation.

## Objectives

Implement secure user authentication, Battle.net account linking, verified account-to-character mapping, roles and permissions, admin authorization, permission-based refresh cooldown bypass, audit logging and a future-ready entitlement foundation.

Do not implement payments or subscriptions.

## Phase 1 — Audit

Inspect current authentication/session code, admin-key mechanisms, refresh authorization, user-related Prisma models, cookies/tokens, frontend route protection, API middleware, secrets handling, character identity and premium placeholders.

Identify every route protected by a shared admin key or no authentication.

## Phase 2 — Official Battle.net research

Use current official Blizzard/Battle.net developer documentation as the source of truth.

Document authorization flow, scopes, account/profile APIs, region behavior, token lifetime, refresh-token support or lack thereof, account identifiers, protected WoW profile endpoints, character ownership availability and storage-related terms.

Do not rely on memory or third-party tutorials for security-critical behavior.

## Phase 3 — IAM data model

Design a durable model containing at least:

- User
- ExternalIdentity
- BattleNetAccount
- UserSession
- Role
- Permission
- UserRole or equivalent
- VerifiedCharacterOwnership
- AuditEvent
- Entitlement or FeatureGrant foundation

Requirements:

- provider account ID is distinct from display name;
- ownership links preserve verification timestamp and source;
- removed or stale ownership is handled;
- account-to-character relationships are private by default;
- no alt list is public without explicit consent;
- premium readiness does not include payment logic.

Prefer RBAC and add resource ownership checks where required.

## Phase 4 — OAuth security

Implement a secure authorization-code flow.

Requirements:

- `state` validation;
- PKCE where supported and appropriate;
- secure HttpOnly SameSite cookies;
- CSRF protection;
- session rotation;
- logout/revocation behavior;
- callback allowlist;
- no open redirects;
- encrypted provider tokens at rest if persisted;
- provider tokens never sent to the browser;
- secrets never logged;
- production HTTPS requirement;
- configurable session expiry;
- callback-abuse protection.

Document Battle.net outage behavior.

## Phase 5 — Character ownership mapping

After linking:

- fetch only authorized account/profile data;
- normalize region/realm/name/character ID;
- create or update verified ownership records;
- preserve durable provider identifiers;
- handle renamed/transferred characters;
- distinguish current and historical ownership;
- never infer ownership from names alone.

Expose private authenticated APIs for linked account, owned characters, ownership refresh, unlink and optional primary-character selection.

Do not alter public Trust Scores based on alt ownership.

## Phase 6 — Roles and permissions

Replace ad-hoc admin bypasses with explicit permissions.

Suggested permissions:

- `profile.refresh.request`
- `profile.refresh.force`
- `profile.refresh.cooldown_bypass`
- `provider.diagnostics.read`
- `score.candidate.read`
- `score.recalculate`
- `admin.users.read`
- `admin.users.manage`
- `admin.jobs.manage`
- `admin.settings.manage`

Requirements:

- server-side enforcement;
- least privilege;
- default user and admin roles;
- audit every privileged action;
- shared admin key retained only as a documented emergency fallback or removed safely.

## Phase 7 — Refresh integration

- normal users keep cooldowns;
- owners may get configurable privileges but not unlimited WCL access;
- admins bypass cooldown through permission;
- forced provider refetch is separate from score recalculation;
- every bypass is audited;
- WCL budget manager remains authoritative.

Premium/admin status must not silently bypass global safety limits.

## Phase 8 — Premium-ready foundation

Prepare generic entitlements, feature grants, usage limits, expiration and administrative grants.

Do not implement Stripe, checkout or subscriptions.

The scoring result must not become pay-to-win.

## Phase 9 — UI

Implement minimal screens for Battle.net sign-in, callback/error, account settings, linked account, owned characters, unlink confirmation, permission-based admin navigation and access denied.

Do not expose provider tokens or raw private payloads.

## Required tests

1. OAuth state mismatch is rejected.
2. Open redirects are impossible.
3. Session cookie is secure in production.
4. Provider tokens are absent from clients/logs.
5. Ownership requires provider-backed account data.
6. Renamed/transferred character retains durable identity.
7. Public profile does not reveal alts.
8. Normal user cannot bypass cooldown.
9. Admin permission can bypass cooldown.
10. Global WCL safety still applies.
11. Privileged actions create audit events.
12. Unlink invalidates future private sync.
13. Redis loss does not destroy identity data.
14. Migration preserves characters and scores.
15. Build and tests pass.

## Deliverables

Return the audit, official flow summary, data model, threat model, implementation, ownership-sync behavior, RBAC matrix, admin-key migration plan, entitlement design, UI routes, migrations, tests, files changed and commit hash.

Do not implement billing.
Do not expose alt relationships publicly.
Do not change scoring semantics.
