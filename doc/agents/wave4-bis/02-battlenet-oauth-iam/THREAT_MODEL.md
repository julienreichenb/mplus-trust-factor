# IAM Threat Model (Wave 4.3)

## Assets

- Session cookies, provider OAuth tokens, BattleTag / account IDs, ownership graphs, admin permissions, audit integrity.

## Threats and controls

| Threat | Control |
|--------|---------|
| OAuth CSRF / login CSRF | Cryptographic `state` bound to HttpOnly cookie; reject mismatch |
| Auth code interception | PKCE (`S256`); server-side code exchange |
| Open redirect | Callback allowlist; post-login redirect path allowlist (relative only) |
| Session fixation | Rotate session id on login; revoke on logout |
| Token theft from browser | Provider tokens never in responses/cookies; encrypted at rest |
| Token leak in logs | Redaction paths; never log Authorization / raw tokens |
| Privilege escalation | Server-side permission checks; least privilege defaults |
| Admin key sprawl | Key retained as documented emergency fallback; RBAC preferred; audit key use |
| Alt disclosure | Ownership APIs require session; public serializers omit alts |
| Cooldown abuse | Permission `profile.refresh.cooldown_bypass` audited; WCL global safety unchanged |
| Callback abuse | Rate limit OAuth start/callback; one-time state |
| Redis flush | Identity/sessions/ownership in PostgreSQL |

## Production

- HTTPS required for Secure cookies (`APP_ENV=production` / `NODE_ENV=production`).
- Secrets only via env; never `VITE_*` for OAuth client secret or session secret.
