# M+ Trust Factor — Landing & Character UX

This document defines the intended experience for the existing Vue 3 + Vite web app.

## 1. Landing page objective

A visitor must understand in under 10 seconds:

1. M+TS evaluates how trustworthy a character appears for high-key Mythic+.
2. The result is explainable, not a black-box ranking.
3. They can search a character immediately.

Primary conversion: submit Region + Realm + Character and open the character detail page.

## 2. Recommended landing structure

### A. App header

Left: flat M+TS mark + `M+ Trust Factor`.

Right:

- `Methodology`
- `Compare`
- `Data sources`
- compact `Analyze a character` button

Hide `Admin` from the public navigation. Keep it behind an authenticated/admin shell.

### B. Hero — split layout

Desktop: 7/5 columns. Mobile: content, search, visual.

Left:

- Eyebrow: `EXPLAINABLE MYTHIC+ PLAYER INTELLIGENCE`
- H1: `Know who you are inviting.`
- Supporting copy: `M+ Trust Factor turns public character, gear, talent and performance signals into an explainable S–D trust tier for serious Mythic+ groups.`
- Search module embedded directly in the hero.
- Secondary link: `See how scoring works`.

Right:

- detailed logo/hourglass as the key visual;
- behind it, restrained score-card fragments: `Tier A`, `Evidence 91%`, `M+ 3,142`, `Updated 4m ago`;
- no fake character portrait or unverifiable social proof.

Search module:

```text
[ EU ▾ ] [ Realm autocomplete            ] [ Character name       ] [ Analyze → ]
```

Mobile: stack fields; keep CTA full-width.

### C. Trust proposition strip

Three compact statements, not marketing counters:

- `Explainable` — every tier links to dimensions, weights and sources.
- `Current` — freshness is shown per source.
- `Built for high keys` — optimized for expert screening, not casual progression.

### D. Product preview

Use a realistic, clearly labelled demo profile. Layout:

- left: character/model placeholder and identity;
- center: tier badge + radar chart;
- right: evidence completeness + top positive/negative signals;
- lower row: equipment strip and source freshness.

Do not make this a giant static screenshot. Recreate it with real UI components so it remains responsive and reinforces the design system.

### E. How it works

Three steps:

1. `Search` — region, realm, character.
2. `Aggregate` — Blizzard profile, Raider.IO, Warcraft Logs and supported public signals.
3. `Explain` — tier, dimensions, weights, confidence and data freshness.

### F. Methodology callout

A dark-neutral panel with the scoring equation in JetBrains Mono and plain-English explanation. CTA: `Explore the scoring model`.

### G. Footer

Product links, data-source acknowledgements, legal disclaimer and a clear statement that M+TS is an independent community project and is not affiliated with Blizzard Entertainment or Wowhead.

## 3. Hero visual sketch

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [flat mark] M+ TRUST FACTOR       Methodology  Compare  Sources  [Analyze]  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ EXPLAINABLE MYTHIC+ PLAYER INTELLIGENCE           ╭──────────────────────╮   │
│                                                    │       [hourglass]    │   │
│ Know who you are inviting.                        │   TIER A   91% data   │   │
│                                                    │   M+ 3,142 · 4m ago  │   │
│ Explainable trust tiers built from public         ╰──────────────────────╯   │
│ character, gear, talent and performance data.                                 │
│                                                                              │
│ ┌──────┬──────────────────────┬───────────────────┬───────────────┐          │
│ │ EU ▾ │ Realm               │ Character         │ Analyze →     │          │
│ └──────┴──────────────────────┴───────────────────┴───────────────┘          │
│ View methodology                                                            │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Explainable                 Current                     Built for high keys   │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 4. Character detail information architecture

Recommended desktop layout:

```text
Identity + freshness header
┌──────────────────┬───────────────────────────┬────────────────────────────┐
│ 3D model         │ Global tier + rationale   │ Radar + dimension summary  │
│ identity         │ score / confidence        │ strongest / weakest        │
├──────────────────┴───────────────────────────┴────────────────────────────┤
│ Equipped inventory / paper doll                                           │
├────────────────────────────────────┬───────────────────────────────────────┤
│ Current talent tree                │ Calculation / weights / provenance    │
├────────────────────────────────────┴───────────────────────────────────────┤
│ Source freshness, missing data, model version, disclosures                │
└────────────────────────────────────────────────────────────────────────────┘
```

Mobile order:

1. identity;
2. tier + evidence completeness;
3. dimension cards;
4. radar chart;
5. equipment horizontal/compact grid;
6. talents;
7. calculation and provenance;
8. optional 3D model trigger.

The 3D model must not be the first or largest mobile element.

## 5. Character header

Display:

- character name;
- realm and region;
- class + active specialization;
- guild;
- equipped item level;
- current Mythic+ score;
- last successful refresh;
- source-level freshness indicator.

Actions:

- `Refresh data` with rate-limit state;
- `Compare`;
- `Share`;
- external profile links grouped under `Open source profiles`.

## 6. Global tier presentation

The global result is an evidence panel, not a decorative medal.

Required content:

- `A` large tier;
- plain label such as `Strong trust profile`;
- evidence completeness, e.g. `91%`;
- one-sentence explanation generated from deterministic score factors, not freeform AI;
- top 2 positive signals;
- top 2 risks/limitations;
- model version and timestamp.

Never imply safety, skill certainty or guaranteed group performance. Prefer `trust profile`, `available evidence`, and `signals` over `good player` / `bad player`.

## 7. Dimensions and radar chart

Recommended dimensions should remain stable and capped at six. Example working set:

- Experience
- Performance
- Consistency
- Preparedness
- Progression relevance
- Evidence quality

Each dimension card contains:

- normalized score;
- tier/sub-rating;
- short rationale;
- top contributing signals;
- data source and freshness;
- link to calculation details.

The radar chart is a summary, never the sole explanation.

## 8. Equipment UX

- Use real equipment slot semantics.
- Icon click opens the Wowhead item page in a new tab.
- Hover/focus/tap displays a Wowhead tooltip where enabled.
- Show item level, quality, upgrade track, enchant and gems when available.
- Flag missing enchants/gems only when the rules are applicable and sourced.
- Use skeletons while item media loads; preserve slot dimensions to prevent layout shift.

## 9. Talent tree UX

Prefer Blizzard talent loadout/profile data as the source of truth. Render the current selection using local data and media where possible.

For MVP:

- specialization header;
- compact selected-node tree or ordered talent list;
- share/export string when available;
- external link to a supported talent calculator.

Avoid embedding a full third-party calculator as the primary view; it adds coupling and inconsistent interaction patterns.

## 10. Explainability panel

The methodology section must be available inline and on a dedicated page.

Show:

- global equation;
- normalized dimensions;
- current weights;
- tier thresholds;
- missing-data handling;
- confidence/evidence completeness calculation;
- model version;
- raw source timestamps;
- known limitations.

Use disclosure sections, but keep the top-level equation and current weights visible without opening a modal.

## 11. Vue implementation guidance

Suggested component split:

```text
apps/web/src/
  components/
    brand/BrandMark.vue
    search/CharacterSearchForm.vue
    score/TierBadge.vue
    score/DimensionRadar.vue
    score/DimensionCard.vue
    character/CharacterIdentity.vue
    character/CharacterModel.vue
    equipment/EquipmentGrid.vue
    equipment/EquipmentSlot.vue
    talents/TalentTree.vue
    methodology/ScoreEquation.vue
    provenance/SourceFreshness.vue
  pages/
    HomePage.vue
    CharacterPage.vue
    MethodologyPage.vue
```

Rules:

- Extract the existing search form from `HomePage.vue` before redesigning the page.
- Keep URL construction through the existing `canonicalCharacterPath` helper.
- Preserve current realm autocomplete keyboard behavior and E2E selectors.
- Add presentational components around existing contracts rather than altering API response shapes for visual convenience.
- ECharts remains acceptable for radar/bar charts; define options in dedicated composables and expose an accessible table alongside each chart.
- Lazy-load `CharacterModel.vue` only after the core score content has rendered or when it enters the viewport.

## 12. Acceptance criteria

- Search is usable without scrolling at 1366×768.
- Search remains complete and keyboard-operable at 360 px width.
- Core Web Vitals are not blocked by 3D/model-viewer scripts.
- No layout shift when equipment icons or 3D assets load.
- Full character result remains understandable with JavaScript-based Wowhead enhancement disabled.
- Tier and every dimension have a textual explanation and data freshness.
- `prefers-reduced-motion` removes ambient animation.
