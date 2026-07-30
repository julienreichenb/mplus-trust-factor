# Brand and front-end UX system

Status: **canonical** for `apps/web/**`.  
Product: **M+ Trust Factor**. Published metric: **Trust Score**. Short mark: **M+TS**.

Sources: PR #1 structure + PR #2 detail, corrected for current product facts. Retention record: [`PR-CONSOLIDATION-RECORD.md`](PR-CONSOLIDATION-RECORD.md).

## 1. Design thesis

M+TS is an expert decision-support product for high-key Mythic+ players — not a generic WoW fan site.

Target balance: **75% modern SaaS / data**, **25% Warcraft atmosphere** (warm stone, bronze, restrained amber, angular details). Do not use parchment pages, ornamental frames on every card, medieval body copy, fake game UI or heavy textures.

Principles:

1. Evidence before spectacle — scores, sources, freshness and uncertainty are visible.
2. Dense but scannable.
3. Fantasy in framing, SaaS in interaction.
4. Tier is not a verdict — pair S–D with numeric evidence, dimensions and methodology.
5. Dark-first, accessible always — never rely on hue alone.

## 2. Logo system

| Variant | Path / use |
|---------|------------|
| Flat product mark | `apps/web/public/brand/mpts-mark.svg` — nav, compact states |
| Favicon | `apps/web/public/favicon.svg` |
| Wordmark | **M+ Trust Factor** — never set the full wordmark in the fantasy display font below 24 px |

Do not reproduce Blizzard / WoW logos or proprietary typefaces.

## 3. Palette and tokens

Canonical implementation: **`apps/web/src/design-tokens.css`** (imported by `apps/web/src/styles.css`).

Do not introduce a second token file under `styles/design-tokens.css`. Prefer existing `--color-*` tokens already used by the app; optional `--mpts-*` aliases may be added only if they map 1:1 and do not fork the palette.

Tier color is secondary — always render the letter. Brand amber should occupy roughly ≤10% of a normal application screen.

## 4. Typography

Open-source families (SIL OFL), self-hosted:

| Family | Role |
|--------|------|
| Inter | Product UI (body, nav, forms, tables) |
| Cinzel | Rare display accent only |
| JetBrains Mono | Scores, timestamps, IDs, data values |

## 5. Public skill dimensions (UI)

Radar / dimension cards must use exactly these four axes:

1. Performance  
2. Survival  
3. Utility  
4. Experience  

Do **not** invent Consistency / Preparedness / Progression relevance / Evidence quality as skill dimensions.  
Do **not** market five or six public skill dimensions.  
Authenticity / boost suspicion is a separate flag + evidence panel.  
Confidence / freshness are presentation metadata, not skill axes.

Spider chart: at most **four** skill series (plus accessibility table). “Maximum 6” language is obsolete.

## 6. Score presentation

Near every Trust Score show:

- model version;
- freshness / last published time;
- confidence or uncertainty;
- methodology link or short explanation;
- boost suspicion only with probabilistic wording.

Design loading, partial, unavailable, stale and failure states. Preserve keyboard access, reduced-motion support and a text equivalent for charts.

## 7. Route and test stability

Preserve route behaviour and existing E2E `data-testid` values unless tests change in the same PR.

## Related

- Landing / player UX: [`landing-and-player-ux.md`](landing-and-player-ux.md)
- Blizzard / Wowhead: [`wow-content-integration.md`](wow-content-integration.md)
- Cursor rule: [`.cursor/rules/mpts-frontend-brand.mdc`](../../../.cursor/rules/mpts-frontend-brand.mdc)
