# Entitlement / FeatureGrant foundation

## Principles

- Generic grants only — no Stripe, checkout, subscriptions, or pricing.
- Scoring must not become pay-to-win; entitlements may unlock UX depth, not inflate Trust Scores.
- `PUBLIC_DETAILS_ALL` remains the global MVP unlock flag for serializers.

## Models

| Model | Use |
|-------|-----|
| `Entitlement` | Time-bounded feature keys (`startsAt`/`endsAt`, `source`, `metadata`) |
| `FeatureGrant` | Same plus optional `usageLimit` / `usageCount` for rate-shaped features |

## Suggested keys (not enforced yet)

- `details.unlocked`
- `runs.unlocked`
- `compare.expanded`
- `refresh.priority` (queue priority only — never WCL global bypass)

Administrative grants set `source=admin` and optional `grantedBy`.
