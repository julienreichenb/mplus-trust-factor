# Deployment checklist

## Pre-deploy

- [ ] Set `PROVIDER_MODE=live` only with valid provider credentials
- [ ] Set strong `ADMIN_API_KEY` and `SESSION_SECRET` (≥32 chars)
- [ ] Run `pnpm db:migrate` against production Postgres
- [ ] Run `pnpm db:seed` (idempotent) for baseline regions/models
- [ ] Set `PUBLIC_DETAILS_ALL` per entitlement strategy
- [ ] Configure `WEB_ORIGIN` and `PUBLIC_BASE_URL`
- [ ] Build images: `docker build -f infra/docker/Dockerfile.local --target api .`
- [ ] Verify health: `GET /health/live`, `GET /health/ready`

## Post-deploy

- [ ] Smoke: search → refresh → profile returns score
- [ ] Verify OpenAPI at `/docs`
- [ ] Run addon export job; confirm `MPlusTrustData.lua` generated
- [ ] Confirm no secrets in logs (Pino redaction)

## Not in MVP scope

- Public launch without Raider.IO legal review
- Multi-region production Redis response cache
