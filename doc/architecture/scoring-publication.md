# Scoring publication

## Immutable snapshots

- Each calculation persists a `ScoreSnapshot` with model version, timestamps and publication status.
- Prior public snapshots are superseded (`SUPERSEDED`) when a new public snapshot is published.
- Public reads resolve via `CharacterPublishedScore` (last-known-good pointer).

## Publication outcomes

| Outcome | Effect |
|---------|--------|
| Public publish | New snapshot `isPublic`; pointer updated; previous public superseded |
| Reject incomplete | Candidate stays non-public; pointer unchanged |
| Soft provider failure | Merge last-known-good observations for failed dims; keep published pointer |

## Model versioning

Scores are always tied to a concrete score-model version. Recalculation after activation should prefer `RECALCULATE_ONLY` when evidence is compatible (see [`../operations/model-lifecycle.md`](../operations/model-lifecycle.md)).

## Public DTO rules

- Expose four public skill dimensions (zero-weight RAID filtered out).
- Authenticity / boost as metadata + red flags, not as a fifth skill axis.
- Never leak raw provider payloads.
