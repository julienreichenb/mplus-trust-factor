# Blizzard and Wowhead presentation integration

Status: architecture decision for character media, equipment, talents, icons and links.

## Decision

Use **Blizzard as the source of truth**. Use **Wowhead only as optional presentation** (tooltips + outbound links).

### Blizzard owns

- character identity, level, class, specialization, guild;
- equipped items and item IDs;
- item level;
- talents / loadouts;
- Mythic+ profile data where used;
- character and item/spell media.

### Wowhead may enhance

- item and spell hover tooltips (documented script);
- outbound links the user explicitly opens.

Do **not**: scrape Wowhead, embed its model viewer, depend on undocumented private endpoints, or use Wowhead as a backend data source.

## Character visual

Production-safe ladder:

1. Blizzard `main-raw`
2. `inset`
3. `avatar`
4. class/spec placeholder
5. future licensed 3D behind an explicit interface — not Wowhead internals

Present as a **character render**, not an interactive third-party 3D embed.

## Product UI requirements

- Core profile and equipment UI must work when all third-party scripts are blocked.
- Contracts should expose stable item IDs and media URLs for equipment grids (extend DTOs backward-compatibly when needed).
- Never mix provider-specific payloads into public score DTOs.

## Related

- Brand system: [`brand-and-ux-system.md`](brand-and-ux-system.md)
- Player UX: [`landing-and-player-ux.md`](landing-and-player-ux.md)
