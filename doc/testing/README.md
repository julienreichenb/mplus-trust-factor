# Testing notes (Agent 0 foundation)

- Unit tests: Vitest, `PROVIDER_MODE=fixture`
- Integration: Compose Postgres via `pnpm test:integration`
- API health: Fastify inject
- Queue payloads: Zod schemas in `@mplus/contracts`
- Web: router smoke test
- Scoring engine tests: `describe.todo` owned by Agent 4

Agent 9 expands security, Playwright, and broader fixture utilities.
