# Known limitations

## Providers

- **Warcraft Logs / Raider.IO live packages** throw `notImplemented`; worker uses deterministic fixture adapters.
- **Blizzard live** requires credentials; fixture mode uses file fixtures with worker fallback for arbitrary test names.
- **Raider.IO commercial use** must be reviewed before public/competing launch.

## Scoring

- Metric extractors in the refresh pipeline are simplified; full observation assembly is a calibration follow-up.
- Boost/authenticity language is probabilistic; no dispute workflow yet.
- Model v1 weights are hypotheses pending expert calibration.

## Product

- Admin auth is MVP API-key only.
- Response cache is in-memory (single API instance).
- Web e2e tests run in mock mode by default.
- Entitlements flag `PUBLIC_DETAILS_ALL=true` unlocks all fields at launch.

## Performance

- No Redis-backed API response cache for multi-instance deployments.
- Addon export loads all season snapshots into one Lua file (MVP scale).
