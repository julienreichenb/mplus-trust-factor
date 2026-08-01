---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 11 — Admin diagnostics and public explainability

## Dependencies

- V2 APIs/contracts stable.
- Avoid concurrent route/navigation changes with calibration UI work.

## Objective

Expose evidence quality and calculation semantics without leaking sensitive WCL/account data.

## Admin UI

Add views for:

- manifest 2×dungeon matrix;
- selected/fallback/rejected candidates;
- dataset states/cost/pages/truncation;
- fact-set versions;
- per-run component facts;
- dimension calculation and confidence;
- V1/V2 comparison;
- batch/queue state;
- calibration links.

Admin-only report code display must follow security policy.

## Public profile

Expose:

- analyzed runs / expected runs;
- represented dungeons;
- confidence per dimension;
- provisional/stale/unavailable state;
- concise top contributors;
- selected key levels without report codes;
- algorithm/model data-as-of;
- explicit Utility observed-contribution semantics;
- U means unavailable/unranked.

## API

- additive versioned DTOs;
- no raw artifacts/events;
- no private linked-character identities;
- no sensitive provider errors;
- pagination/bounds for admin lists.

## Tests

- flags/RBAC;
- hidden/unlisted sanitization;
- full/partial/insufficient states;
- consistent API/UI semantics;
- report codes absent publicly;
- no provider calls from GET;
- accessible copy and responsive layout;
- English-only policy if repository requires it.

Run full validation. Stop at checkpoint. No flag enable/deploy.
