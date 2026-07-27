# M+ Trust Score — Brand and Front-end UX System

Status: canonical guidance for `apps/web/**`.
Product language: English.

## 1. Design direction

M+ Trust Score must feel like a serious analytics product for experienced Mythic+ players, not a generic fantasy fan site.

Target balance:

- 75% modern SaaS / data product
- 25% Warcraft-inspired atmosphere

Use the Warcraft layer through warm stone, bronze, restrained amber light, angular details and the emblem. Do not use parchment backgrounds, ornamental frames around every card, medieval body copy, fake game UI or excessive textures.

Core promise:

> A transparent, evidence-backed trust signal for serious Mythic+ groups.

## 2. Logo system

Use three levels instead of scaling one detailed image everywhere.

1. **Hero emblem** — detailed hourglass/shield artwork for the landing hero, social cards and large empty states. Minimum recommended size: 220 px.
2. **Flat product mark** — `apps/web/public/brand/mpts-mark.svg` for navigation, compact cards and loading states.
3. **Favicon** — `apps/web/public/favicon.svg`, flat and readable at 16 px.

Preferred public name: **M+ Trust Score**. Compact form: **M+TS**. Avoid mixing “Trust Factor”, “Trust Score”, “MPTS” and “M+TS” on the same surface.

## 3. Palette

Canonical implementation: `apps/web/src/styles/design-tokens.css`.

The palette comes from the supplied logo: near-black, warm stone, bronze, ember and amber. Amber is a signal color, not a background color.

### Foundation

| Token | Hex | Use |
|---|---:|---|
| `--mpts-void-950` | `#090705` | page background |
| `--mpts-surface-900` | `#17110D` | cards |
| `--mpts-surface-800` | `#211810` | inputs / raised cards |
| `--mpts-border-subtle` | `#3B2B1E` | separators |
| `--mpts-text-primary` | `#F7E8CF` | primary text |
| `--mpts-text-secondary` | `#C9B18D` | secondary text |
| `--mpts-text-muted` | `#927B60` | metadata |

### Brand

| Token | Hex | Use |
|---|---:|---|
| `--mpts-brand-amber` | `#F2AD37` | primary CTA, focus, selected state |
| `--mpts-brand-ember` | `#CF7116` | gradient depth |
| `--mpts-brand-bronze` | `#914B12` | decorative depth only |
| `--mpts-brand-stone` | `#B2946A` | neutral highlight |
| `--mpts-brand-ivory` | `#F0DEB7` | premium accent text |

### Tiers

- S `#F4C653`
- A `#5FD39A`
- B `#65A9E8`
- C `#A58BE8`
- D `#E76F65`

Always pair tier color with the visible letter. Do not tint an entire page with the tier color. Brand amber should occupy roughly 10% or less of a normal application screen.

## 4. Typography

Use three open-source families, all commercially usable under the SIL Open Font License 1.1.

### Inter — product font

Use for body text, navigation, buttons, forms, tables, explanations and most component headings. Recommended weights: 400, 500, 600, 700.

Rules:

- 15–16 px body size
- 12 px minimum metadata size
- sentence case
- 1.55–1.7 line height for long copy

### Cinzel — display accent

Use for marketing H1, rare page-level statements and major methodology callouts. Recommended weights: 600, 700.

Never use Cinzel for paragraphs, form labels, tables or dense cards. Maximum two Cinzel blocks above the fold. This is the Warcraft-adjacent accent, not the default UI font.

### JetBrains Mono — data font

Use for scores, item levels, key levels, percentages, model versions, timestamps, equations and weights. Use tabular numerals. Labels remain in Inter; only values switch to the mono font.

Preferred delivery: self-host with maintained Fontsource packages and keep the OFL notices in the repository. Suggested packages:

```bash
pnpm --filter @mplus/web add @fontsource-variable/inter @fontsource/cinzel @fontsource-variable/jetbrains-mono
```

## 5. Layout and visual language

- Marketing max width: 1240 px
- Profile max width: 1360 px
- Desktop: 12-column grid, 24 px gutters
- Mobile page padding: 20 px
- Desktop page padding: 40 px
- Card radius: 12–16 px
- Control radius: 8–12 px
- Default card: one subtle border, warm dark surface, restrained shadow

Avoid glassmorphism in data-heavy sections. Use amber glow only for primary action, focus, current selection and the active grade.

Use one consistent outline icon set for generic product actions. Use official Blizzard media for game entities. Do not use fantasy swords, shields or skulls for generic navigation actions when a standard icon is clearer.

## 6. Content and trust presentation

The audience is expert. Do not explain basic WoW concepts, but explain the scoring model precisely.

Tone:

- direct
- evidence-oriented
- technically transparent
- never accusatory

Prefer “Public evidence indicates…” and “Confidence is limited by…”. Avoid “guaranteed good player”, “safe invite” or definitive claims based on probabilistic data.

Every score must expose:

- S–D tier
- normalized numeric score where useful
- confidence
- freshness
- model version
- source coverage
- methodology link

## 7. Landing page

Reference sketch: `doc/architecture/frontend/landing-page-concept.svg`.

### Above the fold

Desktop split:

- left 7 columns: value proposition and character search
- right 5 columns: compact profile preview plus restrained emblem presence

Copy:

- Eyebrow: `EXPLAINABLE MYTHIC+ TRUST SIGNALS`
- H1: `Know who you are inviting before the key starts.`
- Body: `M+ Trust Score turns public character, run and combat data into a transparent S–D trust tier — with the evidence, confidence and model behind it.`

Search fields:

- Region
- Realm autocomplete
- Character name
- Primary action: `Analyze player`

Preserve current behavior and E2E hooks: `region-select`, `realm-input`, `name-input`, `search-submit`.

Trust microcopy:

`Public data only · Explainable scoring · No Battle.net login required for lookup`

The hero visual must prove the product: character identity, tier, confidence, mini radar and three evidence rows. Do not place the detailed logo alone in an empty right column.

### Supporting sections

1. One signal, six dimensions
2. Built from evidence, not vibes
3. Every score is inspectable
4. Designed for serious keys
5. Final search CTA

Do not invent testimonials, usage counters or customer logos.

Recommended component extraction:

```text
components/search/CharacterSearchForm.vue
components/landing/HeroProfilePreview.vue
components/landing/DimensionOverview.vue
components/landing/MethodologyPreview.vue
components/brand/BrandMark.vue
```

Move the current `HomePage.vue` search logic into one reusable component before redesigning the page. Do not create two independent search implementations.

## 8. Character detail page

First desktop viewport:

- left: character render and identity
- center: tier, score, confidence and freshness
- right: radar and quick evidence summary

Then:

- recognizable WoW equipment slot grid
- current talent build
- dimension breakdown
- run evidence
- flags and uncertainty
- methodology and sources

The grade is the primary scan target, but it must never appear without confidence and freshness nearby. The radar uses six fixed axes and needs an accessible value table. Item icons must have deterministic dimensions, keyboard focus, visible item level and no layout shift when Wowhead tooltips load.

Use class color only as a thin accent or icon treatment; never as a full card background.

## 9. Responsive and accessibility rules

Mobile order: identity → tier/confidence → search/refresh actions → radar → equipment → talents → dimensions → evidence → methodology.

Non-negotiable:

- WCAG AA contrast for text and controls
- visible keyboard focus
- 44 px minimum touch targets
- text equivalent for charts
- reduced-motion support
- designed states for loading, stale, partial, unavailable and failed data
- no critical information communicated by color alone

## 10. Agent checklist

Before merging a front-end change:

- Uses design tokens instead of hard-coded brand colors
- Preserves current route behavior and test IDs
- Keeps 75/25 SaaS-to-Warcraft balance
- Uses Inter / Cinzel / JetBrains Mono only in their assigned roles
- Shows confidence, freshness and methodology near scores
- Works with third-party scripts blocked
- Handles partial provider data
- Remains usable by keyboard and on mobile
