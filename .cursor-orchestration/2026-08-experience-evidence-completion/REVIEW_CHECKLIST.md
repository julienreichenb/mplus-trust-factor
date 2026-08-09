# Review Checklist — Experience Evidence Completion

## Architecture
- [x] Single authoritative scoring path preserved.
- [x] Existing canonical current-season authority reused.
- [x] No parallel hard-coded current-season resolver.
- [x] No `seasonId - 1`.
- [x] No Midnight S1/S2 product constant used for selection.

## Previous real season
- [x] Immediately preceding real Mythic+ season selected chronologically.
- [x] Same-expansion transition covered.
- [x] Cross-expansion transition covered.
- [x] Event/intermediate RIO seasons rejected.
- [x] Long-lived process rollover works without restart dependency.
- [x] Local fixture / non-authority season slugs rejected as previous (`blizzard-season-<n>` only).

## Historical rating
- [x] Blizzard primary.
- [x] RIO fallback only after Blizzard failure.
- [x] RIO fallback exact-season bound.
- [x] Source persisted.
- [x] Successful character-season fact has no normal TTL/refetch.
- [x] Transient failure remains retryable.
- [x] No blend/average between providers.

## Previous regional class rank
- [x] Regional **class** rank, not overall (when proven).
- [x] Exact previous real season required — fail-closed otherwise.
- [x] Intermediate/event-season rank cannot leak.
- [ ] Persisted once per compatible character-season — **scaffolded; no production exact-season source yet** (known acceptable limitation).

## Population cutoff
- [x] Native RIO cutoff identities preserved.
- [x] No unsupported percentile extrapolation on productive path.
- [x] Closed-season policy persisted per region+season.
- [x] No per-character cutoff fetch.
- [x] Wrong region/season policy rejected.
- [x] Partial / non-monotonic / unproven remapped policies fail closed (not standing 25).

## No activity
- [x] null + proven no activity -> E=0 available.
- [x] 0 + proven no activity -> E=0 available.
- [x] 0 + runs/activity -> contradiction.
- [x] provider failure != 0.

## Elite
- [x] Actual historical seasonal 0.1% title only.
- [x] Floor 90.
- [x] Successful empty != failure.
- [x] Replay does not require achievements provider.
- [x] Rollover refresh semantics can discover newly historical elite proof.

## Persistence / replay
- [x] Evidence, not only final E, persisted.
- [x] Character+season compatibility identity present.
- [x] Provider/schema version identity present.
- [x] Warm historical rating calls = 0.
- [x] Replay Blizzard = 0.
- [x] Replay RIO = 0.
- [x] Replay WCL = 0.
- [x] E score/state/confidence/causes identical.
- [x] Process-local ensure state is not required for historical reuse after restart.

## Regression
- [x] P baseline preserved (~94.960).
- [x] S baseline preserved (~72.933).
- [x] U baseline preserved (62.3).
- [x] Composite semantics unchanged (E now participates when available; Wallidrixe composite ~70.691 with E=0).
- [x] API/CharacterScore correct (Experience confidence from dimensionDetails).
- [x] Future invented-season rollover test passes.
- [x] Migration `20260809180000_character_experience_evidence` validated locally.

## Final verdict
- [x] **MERGE READY** (class-rank limitation documented; not claimed complete).
