# Review Checklist — Experience Evidence Completion

## Architecture
- [ ] Single authoritative scoring path preserved.
- [ ] Existing canonical current-season authority reused.
- [ ] No parallel hard-coded current-season resolver.
- [ ] No `seasonId - 1`.
- [ ] No Midnight S1/S2 product constant used for selection.

## Previous real season
- [ ] Immediately preceding real Mythic+ season selected chronologically.
- [ ] Same-expansion transition covered.
- [ ] Cross-expansion transition covered.
- [ ] Event/intermediate RIO seasons rejected.
- [ ] Long-lived process rollover works without restart dependency.

## Historical rating
- [ ] Blizzard primary.
- [ ] RIO fallback only after Blizzard failure.
- [ ] RIO fallback exact-season bound.
- [ ] Source persisted.
- [ ] Successful character-season fact has no normal TTL/refetch.
- [ ] Transient failure remains retryable.
- [ ] No blend/average between providers.

## Previous regional class rank
- [ ] Regional **class** rank, not overall.
- [ ] Exact previous real season proven.
- [ ] Intermediate/event-season rank cannot leak.
- [ ] Persisted once per compatible character-season.

## Population cutoff
- [ ] Native RIO cutoff identities preserved.
- [ ] No unsupported percentile extrapolation.
- [ ] Closed-season policy persisted per region+season.
- [ ] No per-character cutoff fetch.
- [ ] Wrong region/season policy rejected.

## No activity
- [ ] null + proven no activity -> E=0 available.
- [ ] 0 + proven no activity -> E=0 available.
- [ ] 0 + runs/activity -> contradiction.
- [ ] provider failure != 0.

## Elite
- [ ] Actual historical seasonal 0.1% title only.
- [ ] Floor 90.
- [ ] Successful empty != failure.
- [ ] Replay does not require achievements provider.
- [ ] Rollover refresh semantics can discover newly historical elite proof.

## Persistence / replay
- [ ] Evidence, not only final E, persisted.
- [ ] Character+season compatibility identity present.
- [ ] Provider/schema version identity present.
- [ ] Warm historical rating calls = 0.
- [ ] Replay Blizzard = 0.
- [ ] Replay RIO = 0.
- [ ] Replay WCL = 0.
- [ ] E score/state/confidence/causes identical.

## Regression
- [ ] P baseline preserved.
- [ ] S baseline preserved.
- [ ] U baseline preserved.
- [ ] Composite semantics unchanged.
- [ ] API/CharacterScore correct.
- [ ] Future invented-season rollover test passes.
