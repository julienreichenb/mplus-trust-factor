# Admin auth and entitlements

## MVP admin auth

- Header: `x-admin-api-key`
- Compared to `ADMIN_API_KEY` with `crypto.timingSafeEqual`
- **MVP-only.** Do not ship this key to Vue/public bundles. Replace with session/OIDC before production hardening (Agent 8/9).

Documented in `.env.example` as local-dev only.

## Entitlements

- Entitlement checks are server-side (`ApiContainer.publicDetailsAll`, default `true` for MVP).
- When `publicDetailsAll` is false, serializers omit premium fields (dimensions detail, run-level evidence) while keeping summary score/grade/confidence/public red flags.
- Payments are out of scope for MVP.

## Admin capabilities

Protected routes can create/validate/backtest/activate score models, enqueue character recalculation, and CRUD mechanic rules (deactivate via DELETE).
