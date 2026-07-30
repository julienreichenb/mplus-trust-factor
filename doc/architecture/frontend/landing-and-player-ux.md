# Landing and player UX

Canonical UX guidance for marketing landing and character profile surfaces.  
Product name: **M+ Trust Factor**. Score artifact: **Trust Score**.

## Landing

First viewport should communicate:

- brand (M+ Trust Factor / M+TS mark);
- one headline about evidence-backed Mythic+ trust;
- one short supporting sentence;
- primary CTA (search / look up a character);
- one dominant visual (mark or character atmosphere — not a dashboard collage).

Avoid stuffing stats strips, schedule widgets or multi-card marketing grids into the hero.

## Profile hierarchy

Recommended order:

1. Identity (name, realm, class/spec, media).
2. Trust Score summary (tier letter, numeric score, model version, freshness).
3. Uncertainty / boost suspicion (if any) with probabilistic language.
4. Four dimension cards: Performance, Survival, Utility, Experience.
5. Evidence / methodology and equipment.

Never imply safety, skill certainty or guaranteed group performance.

## Dimensions and radar

Stable set (**exactly four**):

- Performance
- Survival
- Utility
- Experience

Each dimension card: normalized score, short rationale, top signals, source/freshness, link to details.  
Radar is a summary, never the sole explanation. Provide an adjacent textual table for accessibility.

## Equipment

- Blizzard is source of truth for slots, item IDs and media.
- Wowhead links/tooltips are progressive enhancement only.
- Preserve slot layout to avoid CLS while media loads.

## States

Design and test: loading, partial evidence, grade U, low confidence (ranked), stale score, refresh queued/in progress, failure with last-known-good still shown.

## Concept art

Optional layout sketch: [`landing-page-concept.svg`](landing-page-concept.svg) (from PR #1; naming in the SVG may still say Trust Score — treat as visual only).
