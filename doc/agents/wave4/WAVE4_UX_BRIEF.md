# Wave 4 — Landing and profile UX brief

## Product direction

- 85% modern data/SaaS, 15% Warcraft atmosphere.
- Dark, premium and technical.
- The Trust Score and its evidence are the product; gear and talents are supporting context.
- Avoid generic card walls, fantasy frames, excessive glow and dashboard clutter.

## Landing page

### Value proposition

Primary message:

> Mythic+ rating shows what a player completed. M+ Trust Factor explains how they performed.

### Required structure

1. Compact header.
2. Hero with character search as the dominant action.
3. Real product preview focused on score, confidence and four dimensions.
4. “Why rating alone is insufficient” comparison.
5. Explanation of the eight highest-key runs.
6. Transparent provider provenance.
7. Short methodology flow.
8. Final search CTA.

### Layout requirements

- No nested card grid in the hero.
- Product preview uses one strong composition rather than many floating widgets.
- Desktop max content width and consistent vertical rhythm.
- Mobile hero search stacks without horizontal overflow.
- Use Cinzel only for major marketing headings; Inter for UI; JetBrains Mono for data.

## Character profile

### Above the fold

Always visible:

- identity, spec and role;
- score and grade;
- confidence and freshness;
- four dimension scores;
- refresh action and provider health;
- concise top positive/negative signals.

### Core content

Recommended navigation:

- **Overview** — score, dimensions and explanations.
- **Highest keys** — eight selected runs and per-run facts.
- **Methodology** — formulas, sources and missing data.

### Secondary collapsible panels

Collapsed by default or placed after core content:

- Equipment.
- Talents and specialization details.
- Provider provenance details.
- Historical experience.
- Technical/raw metric details.

### Progressive disclosure

Each dimension card opens a panel containing:

- score and confidence;
- exact selected-run coverage;
- contributor weights;
- per-dungeon evidence;
- unavailable metrics;
- formula version.

### Required states

- FRESH, refreshing and failed refresh.
- UNRATED.
- Partial provider data.
- Missing WCL match.
- Hidden logs.
- Missing equipment/media/talents.
- Mobile tables transformed into readable run cards or horizontally safe tables.

## Acceptance criteria

- Trust Score remains visually dominant at all breakpoints.
- Equipment and talent sections cannot push core score evidence below an excessive first-page scroll.
- No unavailable value displays as zero.
- Every chart has a textual equivalent.
- Landing and profile pass mobile, tablet and desktop visual regression checks.
