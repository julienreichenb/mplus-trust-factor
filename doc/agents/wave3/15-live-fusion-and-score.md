# Agent 15 — Live source fusion, refresh DAG and score

## Branch

`agent/w3-live-fusion-score`

## Start condition

Start only after Agents 11–14 are merged into `integration/wave3-providers`.

## Ownership

- `apps/worker/**`
- `packages/contracts/**`
- `packages/scoring/**`
- persistence changes required for provider states/provenance
- integration tests for the live-shaped fixture pipeline

## Tasks

1. Implement the target DAG from `doc/plans/wave3-live-character-mvp.md`.
2. Use Blizzard as the canonical identity gate, then run independent Raider.IO/WCL enrichment concurrently within provider limits.
3. Persist character-level provider states even when no run exists.
4. Reconcile fields according to `live-source-policy.md`; persist disagreements and excluded observations.
5. Consume Blizzard current-season runs and Raider.IO recent/best runs; deduplicate with source links and match confidence.
6. Attach WCL combat facts only above a documented run-match threshold.
7. Replace `performance.spec_percentile = mythicRating / 3200` with correctly named, season-aware observations.
8. Keep Raider.IO score separate from the product score.
9. Separate score from confidence/coverage/freshness; provider outage or hidden logs must not become a player penalty.
10. Make structural `validateScoreSnapshot` violations block persistence. Keep statistical warnings non-blocking.
11. Serve the last valid stale snapshot while a retryable refresh is queued.
12. Add dedupe, persistent cache use, negative-cache expiry and provider-specific retry classification.
13. Ensure every score explanation contains model version, observations, provider, timestamps, confidence and warnings.

## Constraints

- Preserve fixture mode and existing data migrations safely.
- Do not edit Vue pages.
- Do not call external providers in automated tests.
- Scope only to search/profile score flow.

## Acceptance

Integration tests must cover:

- all providers available,
- Raider.IO unavailable,
- WCL hidden/no logs,
- Blizzard not found/privacy ambiguous,
- 429 with stale snapshot,
- source disagreement,
- low-confidence run match excluded,
- repeated refresh deduped/cached,
- invalid snapshot rejected.

Write `doc/agents/15-live-fusion-score-handoff.md`, commit and stop.
