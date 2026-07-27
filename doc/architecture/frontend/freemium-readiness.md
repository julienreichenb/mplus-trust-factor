# Freemium / entitlement readiness

## Launch posture

Mock fixtures set all entitlements unlocked:

```ts
entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true }
```

No payment UI ships in MVP.

## Rendering rules

- Dimension / authenticity / gear sections respect `detailsUnlocked`
- Analyzed runs respect `runsUnlocked`
- Locked sections show a short message and **do not** invent client-side fetches for hidden payloads
- Security boundary remains the API (Agent 5); the SPA is presentation-only

## Future hooks

When Agent 5 returns entitlements on profile/compare responses, map them onto `CharacterProfileView.entitlements` without changing component call sites.
