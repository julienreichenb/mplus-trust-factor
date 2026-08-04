# Testing notes

See `doc/testing/strategy.md` for the full pyramid and commands.

- Unit + contract + data-quality + security + failure: `pnpm test`
- Integration: `pnpm test:integration` (Postgres via `pnpm dev:infra`) — runs shared then destructive groups, each in its own disposable `mplus_itest_*` database so TRUNCATE/reset tests cannot deadlock concurrent writers
- Load: `pnpm test:load` (local API)
- Fixture governance: `doc/testing/fixtures.md`
- Owned by Agent 9 (`@mplus/test-utils`, `tests/**`)
