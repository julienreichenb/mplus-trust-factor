# Testing notes

See `doc/testing/strategy.md` for the full pyramid and commands.

- Unit + contract + data-quality + security + failure: `pnpm test`
- Integration: `pnpm test:integration` (Postgres via `pnpm dev:infra`)
- Load: `pnpm test:load` (local API)
- Fixture governance: `doc/testing/fixtures.md`
- Owned by Agent 9 (`@mplus/test-utils`, `tests/**`)
