# Wave 3 — Live Character MVP

**Objective:** ship one reliable live-data flow:

`exact character search → queued refresh → persisted score snapshot → character detail page`

The product must continue to support fixture mode. Wave 3 must not expand scope to comparison, admin UX, addon distribution, guild search, leaderboards, authentication, payments, or public production deployment.

## User story

A user enters:

- region (`EU`, `US`, `KR`, `TW` for MVP),
- canonical realm slug,
- exact character name.

The application resolves the character, fetches permitted public data, computes an explainable score, persists the result, and displays a profile with freshness, confidence, source attribution, and partial-data warnings.

## Source responsibilities

| Source | MVP responsibility | Must not be treated as |
|---|---|---|
| Blizzard | Canonical identity, class/spec, media, equipment, current Mythic+ profile/rating, current season metadata | Complete run history or infallible single source of truth |
| Raider.IO | Current score/ranks, best/recent runs, profile URL and supporting consistency signals | Authoritative identity or sole score input |
| Warcraft Logs | Public-log visibility and bounded combat evidence for selected runs | Proof of all activity; absence of logs is not negative evidence |

## Required behavior

1. **Exact identity only.** No fuzzy global character search. Validate region, canonical realm slug and character name before enqueueing.
2. **Blizzard is the identity gate.** A confirmed Blizzard `NOT_FOUND` ends the refresh. Privacy-disabled/ambiguous 404 states must be described without claiming the character does not exist.
3. **Partial success is allowed.** Raider.IO or WCL failure must not prevent a Blizzard-backed profile and score when enough data remains.
4. **No fabricated certainty.** Missing/hidden WCL data lowers evidence confidence; it must not directly punish the score.
5. **Explainable score.** Every dimension and warning must identify its normalized inputs, provider, observation time and confidence.
6. **Source disagreement is visible.** Persist disagreement warnings instead of silently overwriting one provider with another.
7. **Live calls are bounded.** Timeouts, retries with jitter, `Retry-After`, provider budgets, deduplication, cache TTLs, and circuit-breaking are required.
8. **Secrets stay server-side.** Never expose Blizzard/WCL credentials or provider application keys through `VITE_*`, API responses, logs, fixtures, or persisted payloads.
9. **Public API only.** Wave 3 uses WCL `/api/v2/client`; no user OAuth, private reports, or unlisted-report discovery.
10. **No external calls in CI.** Unit/integration/E2E remain deterministic with fixtures. Live smoke tests are explicit, allowlisted and manually invoked.
11. **Terms gate.** Public launch or monetization remains blocked until Blizzard and Raider.IO terms have been reviewed for the intended product.

## Live refresh target DAG

```text
validate exact identity
→ resolve Blizzard canonical profile
→ fetch Blizzard equipment/spec/media/current M+ profile
→ fetch Raider.IO profile with explicit fields
→ discover bounded public WCL evidence
→ reconcile sources and persist provenance
→ extract metrics and confidence
→ validate snapshot (blocking for structural invariants)
→ persist score snapshot
→ return profile through API
→ poll and render in Vue
```

Provider calls that are independent should run concurrently after Blizzard identity resolution, while respecting per-provider concurrency limits.

## Score MVP rules

- Do not rename raw Blizzard Mythic rating as a percentile.
- Remove fixed normalization constants such as `rating / 3200` unless they are versioned and justified for the active season.
- Prefer season-aware normalization derived from documented thresholds/cutoffs when reliable; otherwise expose a transparent bounded heuristic with a low-confidence flag.
- Separate:
  - **performance evidence**,
  - **experience/consistency evidence**,
  - **execution evidence from public logs**,
  - **authenticity risk indicators**,
  - **data confidence/freshness**.
- Do not equate Raider.IO score with the M+ Trust score.
- Hidden/no-public WCL logs may reduce the WCL coverage contribution only.
- A score must include model key/version, input observations, provider timestamps, warnings and confidence.

## API response minimum

The character detail response must include:

- canonical identity and profile media,
- class/spec/role and equipped item level,
- Blizzard Mythic rating,
- Raider.IO score/rank/profile URL when available,
- selected recent/best runs with provider attribution,
- overall trust score and dimensions,
- confidence/coverage/freshness,
- public WCL visibility and bounded combat summary when available,
- provider states (`OK`, `STALE`, `UNAVAILABLE`, `RATE_LIMITED`, `PRIVATE_OR_HIDDEN`, `NOT_FOUND`),
- source disagreement warnings,
- refresh status and last successful refresh time.

## Definition of done

- A manually selected real EU character can be searched from the Vue UI and reaches a persisted profile without database edits.
- The same flow works with WCL disabled and with Raider.IO disabled.
- A private/no-log WCL character still receives a profile with honest confidence messaging.
- A nonexistent Blizzard identity returns a stable not-found state and is negatively cached for a bounded period.
- A second refresh respects deduplication and cache TTLs.
- No secret appears in browser network payloads, logs, `ExternalPayload`, test artifacts, or Git history.
- Fixture acceptance suite stays green.
- A dedicated live smoke command prints a redacted provider summary and exits non-zero on a real failure.
- Provider research and operational runbooks are updated with exact endpoints, fields, attribution and known limitations.

## Explicit non-goals

- Compare page enhancements
- Admin model UX
- Addon feature work
- Guild/leaderboard discovery
- User accounts
- Private WCL reports
- Full historical combat-log ingestion
- Production hosting
- Final commercial/legal approval
