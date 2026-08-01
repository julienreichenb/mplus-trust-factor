---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Testing, validation, and observability

## 1. Test pyramid

### Unit

- selectors and tie-breakers;
- policy interpolation;
- formulas;
- catalog availability;
- fact extraction;
- confidence;
- fingerprints and hashes.

### Contract

- WCL JSON adapters;
- WCL event/table schemas;
- Blizzard profile/season/achievement adapters;
- Raider.IO optional fields;
- API/OpenAPI;
- BullMQ payloads;
- database constraints.

### Integration

- DB transactions;
- artifact store;
- Redis cache/admission;
- queue fan-out/fan-in;
- calibration replay;
- publication pointer.

### End-to-end

- character refresh;
- coverage fallback;
- V2 shadow report;
- admin calibration;
- public profile explanation;
- cancellation and retry.

### Live probes

Sanitized, manual or explicitly authorized only:

- WCL profile and candidate discovery;
- report metadata;
- one event dataset per type;
- table/event parity;
- Blizzard prior season;
- achievements;
- Raider.IO historical fields.

Live probes never run automatically in standard CI.

## 2. Fixture matrix

Include:

- 16 valid runs;
- one missing second log;
- archived top candidate with valid fallback;
- hidden profile;
- report revision update;
- wrong spec/role candidate;
- multiple fights in one report;
- pet-owned actions;
- event pagination;
- truncated dataset;
- high/low key parses;
- zero/one/multiple deaths;
- no low-health windows;
- defensive not talented;
- interrupt overlap and unmatched attempt;
- no utility opportunity;
- prior-season provider failure versus no activity;
- achievement account-visible ambiguity;
- low critical-mass reference slice.

## 3. Golden replay

For each reference fixture:

- freeze input bundle;
- run calculation;
- store expected normalized facts, metrics, dimensions, confidence, and explanation;
- enforce deterministic hash;
- require explicit fixture/version update for changes.

Golden tests must not overfit live mutable values.

## 4. Property tests

Examples:

- adding missing evidence cannot reduce slot count;
- selection invariant to candidate input order;
- parse values do not affect selection;
- score stays in [0,100];
- confidence stays in [0,1];
- missing optional component never becomes zero;
- reference contribution remains bounded;
- identical frozen bundle produces identical report;
- changing any scoring input changes fingerprint.

## 5. Failure injection

Inject:

- WCL 429/5xx/timeout;
- invalid rate snapshot;
- schema drift;
- repeated pagination cursor;
- artifact write failure;
- DB failure after provider fetch;
- worker termination after slot claim;
- Redis unavailable;
- cancellation;
- concurrent finalizers;
- migration incompatibility.

Verify no duplicate spend, no corrupt manifest, and no partial publication.

## 6. Performance/load tests

Measure:

- refresh wall time by stage;
- WCL points and calls per character;
- cache hit rate;
- bytes fetched/stored;
- peak worker memory;
- DB query count;
- 16-slot queue latency;
- fairness across concurrent characters;
- calibration replay throughput.

## 7. Observability events

Required structured events:

```text
scoring_v2.discovery_started/completed
scoring_v2.manifest_frozen
scoring_v2.admission_admitted/deferred/stopped
scoring_v2.slot_started/completed/failed
scoring_v2.dataset_cache_hit/fetched/truncated
scoring_v2.fact_set_written
scoring_v2.batch_ready/finalized
scoring_v2.publication_candidate/published/rejected
scoring_v2.calibration_started/completed
scoring_v2.reference_slice_state_changed
```

Never log report codes, access tokens, raw character names, or unlisted URLs without sanitization policy.

## 8. Metrics

- manifest coverage distribution;
- slots per character;
- fallback depth;
- invalid candidate reasons;
- dataset completeness/truncation;
- WCL points per dataset/dimension;
- provider/cache latency;
- score/confidence distributions;
- V1/V2 deltas;
- provisional/rejection rate;
- queue depth/age;
- artifact bytes;
- calibration correlation/outliers;
- reference critical-mass state.

## 9. Alerts

- service image version skew;
- WCL rate snapshot stale;
- schema unsupported spike;
- truncation spike;
- fallback exhaustion;
- publication rejection spike;
- queue stalled;
- orphan artifacts;
- DB JSONB row size threshold;
- V2 score distribution drift;
- reference slice below minimum.

## 10. Acceptance gates by stage

Each prompt/PR must state which stage it advances and prove:

- no unintended provider calls;
- no public behavior change unless stage allows;
- all full suites green;
- new tests cover failure paths;
- artifact/addon generated files restored only by approved commands;
- migrations validate on empty and upgraded disposable DB.
