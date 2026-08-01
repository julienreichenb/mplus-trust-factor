---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Security, privacy, and provider compliance

## 1. Secrets

- WCL, Blizzard, Raider.IO credentials remain server-side.
- No secrets in frontend bundles, logs, artifacts, or calibration exports.
- Provider tokens use least privilege and encrypted secret storage.
- Unlisted/private WCL report codes are sensitive.
- Artifact download endpoints require admin authorization and audit.

## 2. Public logs and visibility

A public character profile does not authorize disclosure of private/unlisted reports.

Rules:

- use public WCL API credentials for public scoring;
- do not probe guessed report codes;
- do not expose report codes in public API unless product/legal policy approves;
- honor hidden/private provider state;
- stop reusing evidence if visibility is revoked according to retention policy.

## 3. Account linking

Battle.net account character discovery requires user OAuth consent.

- store durable provider account subject, not BattleTag as identity;
- encrypt access/refresh tokens;
- support unlink/revoke;
- ownership state can become stale/revoked;
- linked character list is private by default;
- Phase 2 Experience exposes only bounded derived evidence where allowed.

## 4. Raw evidence privacy

WCL event artifacts may include other group members.

- minimize data to required fights/datasets;
- avoid public exposure;
- apply retention;
- hash/sanitize identifiers in diagnostics;
- restrict admin access;
- document legal/privacy basis before production.

## 5. Logs and observability

Structured logs use:

- character IDs or salted fingerprints;
- sanitized provider errors;
- no tokens;
- no raw payloads;
- no unlisted URLs;
- no complete report codes in broad logs.

## 6. Calibration privacy

Calibration exports:

- default anonymized;
- separate labels/rationale from public report;
- no provider tokens or raw event artifacts;
- hash references verified;
- user-selected cohorts require access control;
- report downloads audited.

## 7. Raider.IO compliance

- use documented API only;
- enforce rate limits/backoff;
- include required public attribution;
- review commercial licensing before monetization;
- do not resell/provider-mirror raw data;
- feature remains optional and clearly sourced.

## 8. Data deletion

Deletion requests must distinguish:

- public provider-derived score snapshots;
- user account/OAuth data;
- calibration research labels;
- raw artifacts involving other players;
- legal/audit retention.

Implement dependency-aware deletion and public-pointer removal.

## 9. Threats

- secret bake into web image;
- SSRF through provider URLs;
- malicious JSON/event size;
- decompression bomb;
- artifact path traversal;
- queue payload tampering;
- hash mismatch;
- admin permission bypass;
- model activation through calibration endpoint;
- cross-tenant/account data exposure.

Tests and size limits are required for each relevant threat.

## 10. Provider terms and schema drift

Provider documentation and terms can change. Keep:

- links and review date;
- adapter versions;
- operational contact/ownership;
- feature kill switch;
- attribution location;
- periodic compliance review.
