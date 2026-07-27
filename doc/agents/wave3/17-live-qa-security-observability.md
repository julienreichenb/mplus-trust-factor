# Agent 17 — Live QA, security, observability and runbooks

## Branch

`agent/w3-live-qa`

## Start condition

Start after Agent 15; coordinate with Agent 16 without editing the same feature files.

## Ownership

- live-shaped test harnesses and recorded fixtures
- security/data-quality tests
- metrics/alerts and operational documentation
- CI configuration

## Tasks

1. Keep all CI tests fixture/recording based; assert zero outbound provider calls.
2. Add manually invoked live smoke orchestration for one allowlisted identity, with redacted output and bounded calls.
3. Add provider contract-drift tests using sanitized recorded responses.
4. Add failure injection for timeout, DNS/network failure, 429, 5xx, malformed GraphQL/JSON, expired token and stale cache.
5. Add secret-leak checks for Git-tracked files, Vite bundle, logs, metrics, API errors and persisted external payload metadata.
6. Add metrics for calls, latency, status, retry, cache hit, rate budget, refresh duration, partial success, score validation rejection and stale serving.
7. Use low-cardinality labels; never label metrics with character name, realm or request URL containing identity.
8. Document dashboards/alerts and a provider-disable rollback procedure.
9. Add a data-retention job/test for raw artifacts and normalized provenance.
10. Add a release checklist with explicit Blizzard/Raider.IO legal approval gates.

## Acceptance

- Full suite passes without internet access.
- Live smoke cannot run without explicit opt-in.
- Failure tests prove partial degradation and stale serving.
- Secret scan has deterministic fixtures and no false claim of comprehensive security.

Write `doc/agents/17-live-qa-handoff.md`, commit and stop.
