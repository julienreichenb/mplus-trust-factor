# Agent 26 — Landing and Trust-Score Profile UX

Work from the merged Agent 21 contract baseline on `integration/wave4`.

Objective: replace the broken landing layout and reorganize the character page around the Trust Score, without implementing score logic in the frontend.

Direction:

- modern startup/SaaS first;
- restrained Warcraft character;
- dark premium data product;
- no card wall, fantasy frame overload or excessive glow.

Landing requirements:

1. Responsive sticky header.
2. Hero with strong value proposition and functional Region/Realm/Character search.
3. One coherent product preview showing score, confidence, four dimensions and the eight-run concept.
4. “Rating shows completion; Trust Factor explains execution.” comparison.
5. Data provenance and methodology.
6. Final search CTA.
7. Loading, validation, not-found and recent-search states.

Profile requirements:

1. Above fold: identity, score, grade, confidence, freshness, four dimensions, refresh and top signals.
2. Core navigation: Overview, Highest Keys, Methodology.
3. Eight selected runs with expandable evidence.
4. Dimension panels with internal weights, per-run evidence and missing metrics.
5. Equipment, talents, provider details and historical experience moved into collapsible secondary panels.
6. Mobile-safe tables/cards and accessible textual alternatives.
7. Preserve U as Unrated and never display unavailable values as zero.
8. Use typed contracts and fixtures; no frontend score calculations.

Run visual regression at desktop, tablet and mobile widths. Deliver screenshots and a concise rationale.
