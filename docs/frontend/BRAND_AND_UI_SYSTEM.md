# M+ Trust Factor — Brand & UI System

Status: normative for the web frontend. Language: English. Product positioning: **75% expert data/SaaS, 25% Warcraft fantasy**.

## 1. Design thesis

M+TS is not a generic WoW fan site. It is an expert decision-support product for high-key Mythic+ players. The interface must feel precise, fast and explainable first; Warcraft references provide identity, not decoration.

Principles:

1. **Evidence before spectacle** — scores, sources, freshness and uncertainty are visible.
2. **Dense but scannable** — expert users tolerate information density, not visual noise.
3. **Fantasy in framing, SaaS in interaction** — use angular frames, stone/gold accents and restrained glow; keep forms, tables, filters and charts conventional.
4. **Tier is not a verdict** — always pair S–D with numeric evidence, dimensions and methodology.
5. **Dark-first, accessible always** — never rely on hue alone for class, tier or state.

## 2. Logo system

The supplied hourglass/shield emblem is the master key visual.

Required variants:

- `brand-mark-detailed`: marketing hero, social preview, splash screens; minimum 128 px.
- `brand-mark-flat`: navigation, empty states, app shell; minimum 32 px.
- `favicon`: simplified shield + check + amber core; 16–64 px.
- `wordmark`: `M+ Trust Factor`; never set the complete wordmark in the fantasy display font below 24 px.

Do not reproduce Blizzard or World of Warcraft logos, UI frames or proprietary typefaces. M+TS must remain clearly independent.

## 3. Color system

The palette is sampled conceptually from the logo: obsidian background, forged iron, warm stone, amber core and gold rim.

### Core tokens

| Token | Hex | Use |
|---|---:|---|
| `obsidian-950` | `#070707` | page background |
| `obsidian-900` | `#0D0D0F` | elevated background |
| `iron-850` | `#171719` | cards |
| `iron-800` | `#202024` | controls / hover surfaces |
| `iron-700` | `#34343A` | strong border |
| `stone-300` | `#C8BDA8` | muted warm text / decorative stone |
| `stone-100` | `#F1E9DB` | primary text |
| `amber-600` | `#D97706` | pressed / dark accent |
| `amber-500` | `#F59E0B` | primary brand accent |
| `amber-400` | `#FBBF24` | hover / highlight |
| `gold-300` | `#F4D58D` | premium edge / subtle highlight |
| `ember-500` | `#F97316` | active energy / warning |
| `success-500` | `#22C55E` | verified / healthy |
| `danger-500` | `#EF4444` | failed / destructive |
| `info-500` | `#38BDF8` | informational state |

### Semantic rules

- Primary CTA: amber fill, near-black text.
- Links: gold/amber, underlined on hover and keyboard focus.
- Surfaces: neutral black/iron. Do not tint every card orange.
- Glow is reserved for the hero mark, active tier badge, selected equipment slot and important CTA. Maximum blur radius: 24 px.
- Borders provide hierarchy before shadows.
- Warcraft class colors may identify class/spec chips and chart series, but must not become the page theme.

### Tier colors

Tier color is a secondary signal. Always render the letter and a label.

| Tier | Color | Meaning |
|---|---|---|
| S | `#F4D58D` | elite confidence |
| A | `#A3E635` | strong confidence |
| B | `#38BDF8` | credible |
| C | `#A78BFA` | situational |
| D | `#FB7185` | weak / insufficient evidence |

Do not use the traditional grey `D` treatment: it looks disabled and hides an actionable result.

## 4. Typography

All selected families are open-source and usable in commercial products under SIL Open Font License 1.1. Self-host WOFF2 files and retain their license files in the repository.

### Inter — UI and prose

Use for body copy, navigation, forms, buttons, tables and explanations.

- Weights: 400, 500, 600, 700.
- Default body: 16 px / 1.55.
- Dense data table: 14 px / 1.4.
- Never use Inter Light on dark backgrounds.

### Cinzel — brand display

Use sparingly for hero headings, major section titles, tier reveals and the wordmark.

- Weights: 600 and 700 only.
- Use uppercase only for short labels, with `0.04em–0.08em` tracking.
- Do not use for paragraphs, form labels, tables or text below 18 px.
- Limit to one dominant Cinzel heading per viewport.

Cinzel evokes engraved fantasy without imitating Warcraft's proprietary visual language.

### JetBrains Mono — data

Use for scores, item levels, key levels, timestamps, equations, model versions, weights and source IDs.

- Enable tabular numerals.
- Use 500 or 600 for KPI values, 400 for metadata.
- Do not use for long explanatory prose.
- Avoid excessive terminal aesthetics; mono communicates precision, not hacking.

### Type scale

- Display: `clamp(2.5rem, 6vw, 5.5rem)` Cinzel 700
- H1: `clamp(2rem, 4vw, 3.5rem)` Cinzel 700
- H2: `clamp(1.5rem, 2.5vw, 2.25rem)` Cinzel 600
- H3: `1.125rem` Inter 700
- Body: `1rem` Inter 400
- Small: `0.875rem` Inter 400/500
- Data XL: `clamp(2.5rem, 5vw, 4.5rem)` JetBrains Mono 600

## 5. Layout and spacing

Use a 4 px base grid.

- Page max width: 1280 px.
- Reading width: 720 px.
- Main gutters: 20 px mobile, 32 px tablet, 48 px desktop.
- Section rhythm: 64 px mobile, 96 px desktop.
- Card padding: 16 / 20 / 24 px.
- Radius: 8 px controls, 12 px cards, 16 px hero panels. Avoid pill-shaped containers except chips and statuses.

Use asymmetry in marketing sections; use strict grids in score and inventory views.

## 6. Components

### Cards

Cards use `iron-850`, a 1 px border and no default drop shadow. Elevated/selected cards may use a subtle amber border and low-opacity glow.

### Buttons

- Primary: one per local decision area.
- Secondary: neutral iron surface.
- Tertiary: text/link treatment.
- Minimum height 44 px.
- Labels start with verbs: `Analyze character`, `Compare players`, `View methodology`.

### Inputs

- Visible labels, persistent helper text only when useful.
- Search form order: Region → Realm → Character.
- Autocomplete must support keyboard navigation, loading, no-result and retry states.
- Do not use placeholder text as the only label.

### Data visualization

- Spider chart: maximum 6 dimensions; show labels outside chart; provide an adjacent textual table for accessibility.
- Avoid filled radar polygons above 18% opacity.
- Every chart includes source freshness and a `How this is calculated` affordance.
- Use horizontal bars instead of radar charts when comparing more than two players.

### Equipment

- Preserve the familiar WoW paper-doll slot arrangement where useful, but do not copy Blizzard chrome.
- Slot icons: 48 px desktop, 40 px mobile; item quality is indicated by border plus textual quality in tooltip/detail.
- Missing slots use a neutral dashed frame, not red.

### Tier badge

The tier badge contains:

- large tier letter;
- textual tier name;
- confidence / evidence completeness;
- score model version;
- timestamp.

## 7. Motion

- Default duration: 140–220 ms.
- Hero mark may use a slow 6–10 second ambient pulse.
- No continuous particle field behind reading content.
- Respect `prefers-reduced-motion`; disable glow pulsing, chart drawing and parallax.

## 8. Accessibility

- Target WCAG 2.2 AA.
- Minimum contrast: 4.5:1 body text, 3:1 large text and UI boundaries.
- Keyboard-visible focus ring: 2 px amber with 2 px offset.
- Tier, item quality, class and status must have non-color labels.
- Charts need equivalent text/table output.
- Tooltips must be reachable by keyboard and tap, not hover-only.

## 9. Anti-patterns

Do not:

- recreate the WoW character sheet pixel-for-pixel;
- use parchment as the main content background;
- place gold borders around every component;
- use fantasy fonts for dense content;
- hide calculation caveats in a modal only;
- present a tier without evidence completeness;
- make the 3D model block initial rendering or score access.
