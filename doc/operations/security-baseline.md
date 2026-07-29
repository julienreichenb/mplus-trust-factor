# Security baseline — dual environment

## Firewall / exposure

| Port | Purpose |
|------|---------|
| 22 | SSH (admin IPs preferred) |
| 80/443 | Shared Caddy only |
| All app/DB/Redis/worker-health ports | **Not published** |

## Isolation checklist

- [ ] Distinct Compose projects `mplus-prod` / `mplus-test`
- [ ] Distinct Postgres + Redis + volumes + networks (app) + backups + locks + releases
- [ ] Distinct `.env` files; test does not reuse prod provider credentials
- [ ] Shared Caddy only on `mplus-proxy`
- [ ] Test CPU/memory limits lower than prod
- [ ] CD uses separate GitHub Environments and secrets

## Secret bake

CI scans built images for `.env` / credential markers (images are shared; runtime secrets stay on the VPS).
