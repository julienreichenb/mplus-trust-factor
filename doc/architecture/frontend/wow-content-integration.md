# M+ Trust Score — Blizzard and Wowhead Presentation Integration

Status: architecture decision for character media, equipment, talents, icons and links.

## 1. Decision

Use Blizzard as the source of truth and Wowhead only as an optional presentation layer.

### Blizzard API owns

- character identity, level, class, specialization and guild
- equipped items and item IDs
- average and equipped item level
- selected talents / loadout data
- Mythic+ profile data
- character media
- official item and spell media

### Wowhead may enhance

- item and spell hover tooltips
- outbound links to item, spell and talent pages
- deeper context the user explicitly chooses to open

Do not scrape Wowhead pages, XML feeds or undocumented endpoints. Do not use Wowhead as a backend source for application contracts.

## 2. Character visual: challenge to the 3D requirement

A true interactive character model is attractive, but it should not be coupled to undocumented Wowhead internals. Wowhead’s public tooling is primarily intended for links and tooltips; its model viewer is not a stable third-party embed API.

Production-safe recommendation:

1. Use Blizzard character media `main-raw` as the primary large render.
2. Fall back to `inset`.
3. Fall back to `avatar`.
4. Fall back to a class/spec placeholder.
5. Keep a provider interface for a future licensed or approved interactive 3D implementation.

Present this as a **character render**, not an interactive 3D model. Do not proxy, reverse-engineer or iframe the Wowhead model viewer.

## 3. Fit with the current repository

The repository already has a replaceable Blizzard provider and calls the official profile endpoints for character, equipment, specializations and media. Preserve that provider boundary.

Current public `EquipmentSummary` is too lossy for the requested UI because `keyItems` only exposes slot, name and item level. The recognizable equipment grid and precise Wowhead links require stable item IDs, media URLs and modifier data.

Make the contract extension backward-compatible rather than replacing existing summary fields immediately.

Suggested UI-facing contracts:

```ts
interface CharacterMediaSummary {
  mainRawUrl: string | null;
  insetUrl: string | null;
  avatarUrl: string | null;
  fetchedAt: string | null;
}

interface EquippedItemView {
  slot: string;
  itemId: number;
  name: string;
  itemLevel: number | null;
  quality: string | null;
  iconUrl: string | null;
  bonusList: number[];
  enchantmentIds: number[];
  gemItemIds: number[];
  transmogItemId: number | null;
}

interface TalentNodeView {
  nodeId: number;
  entryId: number | null;
  rank: number;
  maxRanks: number | null;
  spellId: number | null;
  iconUrl: string | null;
  name: string | null;
}

interface TalentLoadoutView {
  specializationId: number | null;
  specializationSlug: string | null;
  loadoutCode: string | null;
  selectedNodes: TalentNodeView[];
}
```

Recommended additions to `CharacterProfileResponse`:

```ts
level?: number | null;
guildName?: string | null;
mythicRating?: number | null;
media?: CharacterMediaSummary | null;
equippedItems?: EquippedItemView[];
talentLoadout?: TalentLoadoutView | null;
```

Keep `equipment`, `talents` and current fixture fields during migration.

## 4. Backend normalization

### Equipment

- Preserve Blizzard item IDs exactly.
- Preserve bonus-list order.
- Normalize slots to one internal enum.
- Resolve icon media server-side through Blizzard item media.
- Cache static media aggressively by item ID and namespace/version.
- Do not infer missing details from item names.
- Unknown bonus, enchantment or gem IDs remain unknown.

### Talents

- Preserve selected node IDs and ranks.
- Resolve names/icons from official Game Data endpoints when practical.
- Keep the raw loadout code as a copyable fallback.
- Treat partial trees as a supported state.
- Never reconstruct a build from specialization defaults.

### Character media

Normalize Blizzard generic media keys:

- `main-raw`
- `inset`
- `avatar`

Media freshness is separate from score freshness. A stale render must not imply stale score data.

## 5. Front-end architecture

Recommended structure:

```text
components/wow/
  CharacterVisual.vue
  EquipmentGrid.vue
  EquipmentSlot.vue
  TalentLoadout.vue
  TalentNode.vue
components/wowhead/
  WowheadLink.vue
  WowheadTooltipBoundary.vue
composables/
  useWowheadTooltips.ts
lib/
  wowhead-links.ts
```

### `CharacterVisual.vue`

```ts
type CharacterVisualSource =
  | { kind: "blizzard-image"; url: string; alt: string }
  | { kind: "placeholder"; classSlug: string | null; specSlug: string | null }
  | { kind: "approved-model"; assetId: string };
```

The future `approved-model` branch must not point at undocumented Wowhead assets.

### `EquipmentGrid.vue`

Responsibilities:

- fixed recognizable WoW slot order
- deterministic icon dimensions
- quality border as secondary cue
- visible item-level label
- keyboard and pointer interaction
- no provider HTTP or tooltip-script knowledge

### `WowheadLink.vue`

Responsibilities:

- build outbound URLs centrally
- add documented `data-wowhead` parameters
- remain a normal usable anchor if scripts fail
- use `target="_blank"` and `rel="noopener noreferrer"`
- expose an accessible item name

## 6. Wowhead link builder

Do not concatenate links throughout Vue templates.

```ts
interface WowheadItemLinkInput {
  itemId: number;
  bonusList?: number[];
  enchantmentIds?: number[];
  gemItemIds?: number[];
  itemLevel?: number | null;
  transmogItemId?: number | null;
}

interface WowheadLinkResult {
  href: string;
  dataWowhead: string;
}
```

Mapping:

- item ID → `/item=<id>`
- bonuses → `bonus=id:id`
- gems → `gems=id:id`
- known permanent enchant → `ench=id`
- item level → `ilvl=value`
- transmog → `transmog=id` or `transmog=hidden`

Only include parameters backed by provider data.

## 7. Tooltip script loading

Use Wowhead’s documented tooltip script only as progressive enhancement.

```html
<script>
  const whTooltips = {
    colorLinks: false,
    iconizeLinks: false,
    renameLinks: false,
    iconSize: true,
  };
</script>
<script src="https://wow.zamimg.com/js/tooltips.js"></script>
```

Rules:

- Load once and lazily when the first Wowhead-enabled component becomes visible.
- Add a 4–5 second timeout.
- Failure leaves links and all core UI intact.
- Keep `iconizeLinks: false`; use Blizzard icon media to prevent layout shift.
- Do not depend on undocumented Wowhead globals outside `useWowheadTooltips.ts`.
- Disable the integration in tests by default.
- Gate it with `VITE_WOWHEAD_TOOLTIPS_ENABLED`.
- Add required Wowhead domains to CSP only when enabled.

## 8. Privacy, reliability and legal posture

- No Battle.net credentials are sent to Wowhead.
- Never include private identifiers or internal score payloads in outbound URLs.
- Third-party scripts are non-essential and replaceable.
- Core rendering works with CSP blocking all third-party scripts.
- Attribute Blizzard, Raider.IO, Warcraft Logs and Wowhead in the source/methodology area according to their current requirements.
- Re-check current provider terms before commercial launch because policies can change.

## 9. Implementation sequence

1. Extend Blizzard normalization and contracts with IDs/media/modifiers.
2. Add fixtures and contract tests.
3. Build `CharacterVisual` with Blizzard media fallbacks.
4. Build equipment grid using Blizzard icons.
5. Build talent selected-node view with loadout-code fallback.
6. Add centralized Wowhead links.
7. Add lazy tooltip enhancement behind a feature flag.
8. Add CSP, failure, accessibility and E2E tests.
9. Treat interactive 3D as a separate future decision requiring an approved source.

## 10. Acceptance criteria

- A profile shows a Blizzard-hosted character render or clear fallback.
- Every equipped item has a stable item ID and accessible outbound link.
- Equipment remains fully usable when Wowhead is blocked.
- Tooltip loading causes no layout shift.
- Partial equipment/talent/media data has designed states.
- No scraping or undocumented Wowhead dependency exists.
