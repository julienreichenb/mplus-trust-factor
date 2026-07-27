# M+ Trust Factor — Wowhead, Blizzard Media & 3D Integration

## 1. Decision

Use **Blizzard APIs as the source of truth** for character, equipment, specialization, talents and media identifiers. Use **Wowhead only as a progressive enhancement layer** for outbound item links and tooltips.

Do **not** ship an embedded Wowhead 3D model viewer in production without explicit written permission or a documented commercial agreement.

Reasoning:

- Wowhead officially documents its tooltip script for third-party sites and supports links for items, spells and other entities.
- Wowhead does not publish a general public data API for product backends.
- Community libraries that embed the Wowhead/ZAM model viewer depend on private/minified assets, CORS proxies and proprietary Wowhead-hosted game data. Their own documentation warns against large-scale commercial use.
- Historical Wowhead staff statements indicate that third-party embedding of the model viewer is not an approved integration path.

This is both a legal/commercial risk and an architectural reliability risk.

## 2. Supported integration matrix

| Capability | Source | Status | Production recommendation |
|---|---|---|---|
| Character profile | Blizzard Profile API | Official | Use |
| Equipped items | Blizzard Character Equipment API | Official | Use |
| Character/spec media | Blizzard Character Media API / Game Data media | Official | Use |
| Talents/spec | Blizzard Profile/Game Data APIs | Official | Use |
| Item links | Wowhead URLs | Public web links | Use |
| Item/spell tooltips | Wowhead tooltip script | Officially documented | Optional progressive enhancement |
| Item icons | Prefer Blizzard media | Official | Use; Wowhead iconization only as fallback/enhancement |
| Interactive character 3D | Wowhead model viewer internals | Not an official embed API | Do not use by default |
| Community `wow-model-viewer` package | Open-source wrapper over Wowhead internals | Technically possible, upstream/data rights unclear | Prototype only behind a disabled feature flag |

## 3. Architecture

Create provider-neutral presentation contracts. Components must not know how URLs or icons are sourced.

```ts
export interface ExternalGameLink {
  provider: "wowhead" | "blizzard";
  href: string;
  label: string;
}

export interface GameMediaRef {
  id: number;
  kind: "item-icon" | "spell-icon" | "character-render";
  url: string | null;
  source: "blizzard" | "cache" | "fallback";
  updatedAt?: string;
}

export interface CharacterModelDescriptor {
  mode: "static-render" | "interactive-3d" | "unavailable";
  image?: GameMediaRef;
  provider?: "blizzard" | "licensed-third-party";
  unavailableReason?: string;
}
```

Recommended modules:

```text
apps/web/src/integrations/
  wowhead/
    links.ts
    tooltipLoader.ts
    types.ts
  gameMedia/
    mediaAdapter.ts
    types.ts

apps/web/src/components/
  integrations/WowheadLink.vue
  integrations/WowheadTooltipBoundary.vue
  character/CharacterModel.vue
```

The backend/provider layer should resolve Blizzard media and persist normalized URLs/IDs. The frontend should only receive safe, cacheable presentation data.

## 4. Wowhead links

Generate canonical URLs from numeric IDs. Do not scrape Wowhead pages to discover IDs or item metadata.

```ts
export function wowheadItemUrl(itemId: number): string {
  return `https://www.wowhead.com/item=${encodeURIComponent(itemId)}`;
}

export function wowheadSpellUrl(spellId: number): string {
  return `https://www.wowhead.com/spell=${encodeURIComponent(spellId)}`;
}
```

Requirements:

- open external links with `target="_blank"` and `rel="noopener noreferrer"`;
- include accessible labels, e.g. `Open Ashkandur on Wowhead`;
- never make Wowhead the only route to essential item information;
- show local item name, item level and slot before external enhancement loads.

## 5. Tooltip loader

Load the Wowhead tooltip script once, client-side, after consent/policy review and only on routes that need it.

Do not inject it globally in `index.html` unless all public routes need it.

Suggested behavior:

1. Render valid semantic `<a>` links immediately.
2. On character route mount, dynamically load `https://wow.zamimg.com/js/tooltips.js`.
3. Set supported tooltip configuration before loading.
4. Mark loader state as `idle | loading | ready | failed`.
5. On failure, keep links fully functional and suppress retries for the current session.
6. Add CSP allow-list entries only for the exact Wowhead/ZAM hosts used.
7. Review third-party cookie/network behavior before production release.

Pseudo-implementation:

```ts
let tooltipPromise: Promise<void> | null = null;

export function ensureWowheadTooltips(): Promise<void> {
  if (tooltipPromise) return tooltipPromise;

  tooltipPromise = new Promise((resolve, reject) => {
    window.whTooltips = {
      colorLinks: false,
      iconizeLinks: false,
      renameLinks: false,
    };

    const script = document.createElement("script");
    script.src = "https://wow.zamimg.com/js/tooltips.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Wowhead tooltip script failed to load"));
    document.head.append(script);
  });

  return tooltipPromise;
}
```

Keep `iconizeLinks: false`: M+TS controls equipment layout and uses Blizzard-hosted/local icons. Wowhead should enrich details, not rewrite component structure.

## 6. Equipment data flow

```text
Blizzard Character Equipment API
        ↓
API provider normalization
        ↓
item ID + item level + enchant/gems + media key
        ↓
Blizzard item media lookup/cache
        ↓
frontend EquipmentSlot
        ├── local/Blizzard icon
        ├── local textual summary
        └── optional Wowhead link + tooltip
```

Cache item media server-side with a long TTL and patch-aware invalidation. Do not proxy every icon request through the application on every page view.

## 7. Character rendering strategy

### Phase 1 — recommended production baseline

Use Blizzard character media, such as a rendered avatar/bust/full render when available. Present it in the same `CharacterModel` card planned for future 3D support.

Advantages:

- official source;
- fast and cacheable;
- no heavy WebGL bundle;
- no hidden dependency on Wowhead internals;
- mobile-friendly.

### Phase 2 — licensed interactive 3D

Only activate after identifying an official/licensed provider that explicitly allows embedding and commercial use.

The adapter must support:

```ts
interface CharacterModelProvider {
  isSupported(): Promise<boolean>;
  mount(container: HTMLElement, character: CharacterModelInput): Promise<ModelHandle>;
}

interface ModelHandle {
  destroy(): void;
  pause(): void;
  resume(): void;
}
```

Operational requirements:

- dynamic import;
- isolated error boundary;
- loading timeout;
- `destroy()` on unmount;
- pause outside viewport;
- static-render fallback;
- feature flag default `false`;
- no score or equipment dependency on successful model loading.

### Explicitly rejected production approach

Do not copy `viewer.min.js`, proxy `wow.zamimg.com/modelviewer`, or operate a CORS-bypass replica based on community examples. This creates update, bandwidth, licensing and security obligations that are disproportionate to the feature.

## 8. Talent icons and trees

Use Blizzard spell/talent identifiers and official media endpoints where available. Wowhead links may be added to selected nodes, but the tree itself must be rendered from normalized local data.

Do not scrape Wowhead talent calculator pages or consume undocumented JSON endpoints.

## 9. Security and privacy

- Add explicit CSP entries for Wowhead only when tooltips are enabled.
- Use Subresource Integrity only if Wowhead publishes a stable versioned asset with a fixed digest; do not pin an SRI hash to a mutable URL.
- Never expose Blizzard client secrets to the browser.
- Fetch Blizzard OAuth tokens server-side.
- Sanitize all third-party text and URLs before persistence/rendering.
- Track third-party script failures separately from application errors.

## 10. Feature flags

```text
VITE_WOWHEAD_TOOLTIPS=true
VITE_CHARACTER_3D_PROVIDER=disabled
```

Flags are build/runtime configuration, not direct `import.meta.env` checks scattered across components. Resolve them once through the existing frontend configuration layer.

## 11. Legal/product copy

Footer/disclosure:

`World of Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. M+ Trust Factor is an independent community project and is not affiliated with or endorsed by Blizzard Entertainment or Wowhead.`

Do not use `official` to describe M+TS icons, models or score. Say `game data provided through Blizzard APIs` or `links enhanced by Wowhead`.

## 12. Implementation sequence

1. Normalize Blizzard equipment/media contracts.
2. Implement equipment grid with local icons and accessible details.
3. Add canonical Wowhead links.
4. Add optional tooltip loader and failure fallback.
5. Implement static character render.
6. Keep the 3D provider interface disabled.
7. Reassess interactive 3D only after written licensing confirmation.

## 13. Source notes

- Wowhead documents its tooltip script as the supported way to enrich Wowhead links on external sites.
- Blizzard's World of Warcraft Profile APIs expose character equipment and media resources through authenticated API access.
- The community `wow-model-viewer` package uses Wowhead's minified viewer and data assets and warns against large commercial deployments.
- Wowhead forum statements have explicitly rejected general third-party embedding of its model viewer.

Revalidate third-party terms before every production launch or monetization milestone.
