# Frontend accessibility

## Goals

- Keyboard operable search, compare, admin, and series toggles
- Visible `:focus-visible` outlines
- Grade communicated as letter **and** text/score (not color alone)
- Red-flag severity as text labels
- Radar chart always paired with an HTML table (`data-testid="radar-fallback"`)
- Status banners use `role="status"` / `aria-live="polite"`
- Landmark: primary `nav`, page `main`, labeled forms

## Contrast

Dark game-compatible theme with CSS variables. Accent green/blue on dark panels; avoid relying on color alone for grade.

## Responsive

- Profile header stacks below ~800px
- Dimension cards 1→2→3 columns
- Compare table scrolls horizontally on small screens
- Radar height scales with viewport

## Smoke coverage

Playwright checks landmarks/headings; unit tests cover radar fallback text.
