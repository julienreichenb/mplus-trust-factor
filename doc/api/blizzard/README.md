# Blizzard API notes

Owned by Agent 12 (Wave 3 live hardening). Verified MVP paths, namespaces, and fixture contracts live in:

- Provider package: `packages/providers/blizzard/**`
- Fixtures: `tools/fixtures/blizzard/**`
- Research: `doc/research/providers/blizzard-live-api.md`
- Character search / realm catalog: [`../architecture/character-search-and-realm-catalog.md`](../architecture/character-search-and-realm-catalog.md)

Key correction: character media path is `/character-media` (not `/media`).

## Character identity

There is **no** supported Blizzard global or fuzzy character-name search. External lookup is exact:

`profile/wow/character/{realmSlug}/{characterName}`

Realm catalog discovers candidates via Game Data `data/wow/realm/index` and activates only detail-validated player-facing realms (`data/wow/realm/{slug}` + eligibility classifier). Technical index entries are not public.
