---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 10 — Calibration V2 bundle, preflight, replay, and reports

## Dependencies

- Calibration Phase 1 branch merged/rebased or this work occurs in the same coordinated branch.
- V2 manifests and fact sets available.
- No concurrent Prisma/contracts edits without coordination.

## Objective

Adapt the admin calibration platform to Scoring V2 while preserving existing V1 reports.

## Required changes

### Bundle V2

Freeze:

- cohort revision/labels;
- season binding;
- manifest documents/hashes;
- fact-set documents/hashes;
- policy/catalog versions;
- active and draft model configs;
- evidence cutoff;
- deterministic seed.

Use root manifest plus content-addressed references if 4 MiB JSONB is insufficient.

### Preflight

Block on:

- missing/failing hashes;
- insufficient coverage per policy;
- incompatible model/season/spec;
- missing algorithm/catalog version;
- provider work required;
- label leakage;
- duplicate identity/account split issues.

### Replay

- provider-free;
- active/draft identical evidence;
- deterministic;
- source model immutable;
- DRAFT creation only;
- no activation endpoint.

### Reports

Add:

- V1/V2 and active/draft deltas;
- dimension deltas;
- role/class/spec/meta/coverage/key-band slices;
- detailed versus profile Performance disagreement;
- slot coverage;
- provisional rate;
- limitations for small slices;
- cost diagnostics where frozen.

## Compatibility

- old V1 bundles/reports readable;
- explicit schema dispatch;
- no silent conversion.

## Tests

- hash mismatch;
- missing artifact;
- deterministic rerun;
- no providers/refresh;
- same evidence active/draft;
- old report compatibility;
- source model immutable;
- small slice limitation;
- label not derived from score;
- queue isolation;
- cancellation/idempotency.

Run full validation. Stop at distinct Phase checkpoint. Do not enable calibration flags, merge, deploy, or activate.
