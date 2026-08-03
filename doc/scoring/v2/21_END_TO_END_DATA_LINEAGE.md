---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# End-to-end data lineage and granularity

## 1. Lineage overview

```text
External provider request
→ raw response/page
→ schema adapter
→ canonical candidate/profile/run metadata
→ immutable Evidence Manifest
→ selected-run evidence datasets
→ normalized per-run fact sets
→ per-run/per-dungeon metrics
→ dimension computation
→ overall score computation
→ publication snapshot/pointer
→ calibration replay/report
```

Every arrow is a versioned transformation with an input fingerprint.

## 2. Layer 0 — request

Granularity: one external HTTP/GraphQL request.

Persist:

- provider;
- endpoint/operation;
- sanitized request fingerprint;
- timestamps/status/retries;
- cache state;
- cost;
- expiration;
- error code;
- correlation/refresh ID.

Do not persist secrets or unsanitized query variables containing sensitive report codes in broadly accessible logs.

## 3. Layer 1 — raw payload/artifact

Granularity:

- character summary response;
- report metadata response;
- one event/table page;
- Blizzard profile/season/achievement response;
- Raider.IO profile/cutoff response.

Persist:

- content hash;
- schema version;
- compressed artifact location for large content;
- byte size;
- provider/fetch time;
- request reference.

Payload is immutable by hash.

## 4. Layer 2 — canonical metadata

Granularity:

- character identity;
- season/dungeon;
- canonical run;
- WCL report revision/fight;
- candidate row;
- actor/pet map.

No score calculation here.

## 5. Layer 3 — selection manifest

Granularity:

- one character/season/spec-role/refresh contract;
- two slots per active dungeon.

Contains:

- selected references;
- rejection summaries;
- coverage;
- policy/version;
- hash.

This is the only selected-run authority for detailed dimensions.

## 6. Layer 4 — evidence dataset

Granularity:

- one selected slot;
- one dataset compatibility key;
- zero or more pages.

Contains metadata plus artifact references. Events are not repeatedly embedded.

## 7. Layer 5 — normalized facts

Granularity: one selected slot and extractor family/version.

### Performance facts

- parse field and semantic;
- key/bracket;
- adjusted-policy inputs;
- profile aggregate reference.

### Survival facts

- deaths;
- active combat;
- pressure clusters;
- defensives;
- self-recovery;
- relative damage diagnostics;
- evidence modes/limitations.

### Utility facts

- interrupt attempts/classes;
- hostile casts;
- CC actions;
- support/external actions;
- active combat;
- toolkit/catalog coverage.

### Experience facts

Usually character/season-level rather than slot-level:

- breadth/depth/recency;
- prior season state/score;
- achievement evidence;
- historical rank;
- linked-account evidence state.

Facts are semantically stable inputs to models and calibration.

## 8. Layer 6 — metrics

Granularity:

- per run;
- per dungeon;
- per season/dimension;
- optional reference slice.

Examples:

- adjusted parse;
- dungeon floor/peak/consistency;
- death outcome;
- defensive rate;
- recovery coverage;
- interrupt credit/hour;
- exposure score.

Metric keys and normalization versions are immutable.

## 9. Layer 7 — dimension computation

Granularity:

```text
character + season + manifest + score model + dimension
```

Contains:

- score;
- confidence;
- state;
- component weights/values;
- explanation;
- input fingerprint.

No provider calls.

## 10. Layer 8 — overall score snapshot

Granularity:

```text
character + season + scope + active model + input fingerprint
```

Contains:

- four dimensions;
- overall score/rank;
- confidence/eligibility;
- publication state;
- provider-data-as-of;
- manifest/fact/model references;
- explanation.

Immutable. The current published pointer is mutable but auditable.

## 11. Layer 9 — calibration

Calibration does not create new external evidence.

It freezes references/documents from Layers 3–8 plus expert labels and model configs. Its outputs are immutable reports and DRAFT model candidates.

## 12. Reprocessing matrix

| Change | Re-fetch provider? | Re-extract facts? | Recalculate dimensions? |
|---|---:|---:|---:|
| score weights only | no | no | yes |
| confidence formula | no | no | yes |
| difficulty policy | no | no | yes |
| ability semantic | no if raw dataset retained | yes | yes |
| event adapter/schema | maybe | yes | yes |
| report revision | yes/validate | yes | yes |
| active dungeon pool | discovery/selection | affected slots | yes |
| calibration label | no | no | report only |

## 13. Fingerprints

Recommended hierarchy:

```text
requestFingerprint
payloadHash
datasetCompatibilityKey + payloadHash
factInputFingerprint
manifestContentHash
dimensionInputFingerprint
scoreInputFingerprint
calibrationBundleHash
reportHash
```

Each higher fingerprint incorporates lower relevant hashes and algorithm versions.

## 14. Explainability lineage

Admin UI can traverse all layers. Public UI traverses only sanitized summary layers and never raw provider artifacts.
