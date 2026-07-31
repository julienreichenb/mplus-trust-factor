# Frontend English-only audit

**Branch tip inspected:** `9dccc57` (`audit/frontend-english` ≡ `origin/main` at audit time)  
**Scope:** `apps/web` user-visible copy (validation, buttons, headings, placeholders, empty states, banners, frontend-mapped errors, a11y labels; mock/demo only when UI-visible)  
**Method:** Accent / French-lexeme scan of `apps/web/src` (`.vue`, `.ts`, `.html`); manual review of hits; worktree diffs for five parallel frontend branches  
**Production code modified by this audit:** none  
**Finding count:** **15** user-visible non-English strings

## Active branches checked

| User alias | Git branch | Worktree (local) | `apps/web` dirty vs `9dccc57`? | Touches audited French sites? |
|------------|------------|------------------|-------------------------------|-------------------------------|
| `feat-bulk-processing-ux` | `feat/admin-bulk-processing-ux` | `feat-bulk-processing-ux` | Yes (`AdminBulkProcessingPage.vue` + new admin UI) | No |
| `feat/admin-shell-account-polish` | same | `agent-admin-shell-account` | Yes (`AccountPage.vue`, `AppHeader.vue`, `NavDropdown.vue`) | **Yes** — already replaces AccountPage refresh/stale French |
| `feat/character-page-experience` | same | `agent-character-page-experience` | No | No (scope owner for character UI; not started) |
| `feat/admin-ability-catalog-polish` | same | `agent-admin-ability-catalog` | No web Vue for these strings (`packages/abilities` only) | No |
| `feat/admin-refresh-control-center` | same | `agent-admin-refresh-control` | No | No (terminology stakeholder for refresh labels) |

## Excluded (intentionally not findings)

| Location | Text | Why excluded |
|----------|------|--------------|
| `apps/web/src/api/mock/fixtures.ts` ~L27 | `Chérith` | WoW realm proper noun |
| `apps/web/src/api/realm-options.ts` ~L41–51 | `Français`, `Deutsch`, `Español`, `Português`, `Русский`, `한국어`, `繁體中文`, … | Locale **autonyms** for realm language chips — intentionally localized labels for external locale codes |
| `*.test.ts` descriptions / expects that only mirror production French | e.g. `Non calculé` asserts | Not user-visible; **must be updated with production replacements** |
| Comments, identifiers, API payload examples | — | Out of scope |

No other non-English user-visible copy was found under `apps/web` (landing, admin bulk/models/catalog on `main`, auth pages, search, score headers, mock English fixtures).

---

## 1. Safe standalone replacements

Clear French → English. **Not in any active branch’s current dirty diff.** Safe for a dedicated English-copy PR (still coordinate with `feat/character-page-experience` if that branch starts on the switcher).

| # | File | Approx. line / component | Current text | Proposed English | Touched by active branch? |
|---|------|--------------------------|--------------|------------------|---------------------------|
| 1 | `apps/web/src/components/character/BattleNetCharacterSwitcher.vue` | L145 · switcher label | `Mes personnages Battle.net` | `My Battle.net characters` | No |
| 2 | `apps/web/src/components/character/BattleNetCharacterSwitcher.vue` | L150 · owned badge `title` | `Personnage associé à votre compte Battle.net` | `Character linked to your Battle.net account` | No |
| 3 | `apps/web/src/components/character/BattleNetCharacterSwitcher.vue` | L166 · `sr-only` | `Personnage associé à votre compte Battle.net` | `Character linked to your Battle.net account` | No |
| 4 | `apps/web/src/components/character/BattleNetCharacterSwitcher.vue` | L182 · trigger button | `Changer de personnage` | `Switch character` | No |
| 5 | `apps/web/src/components/character/BattleNetCharacterSwitcher.vue` | L231 · empty state | `Aucun autre personnage lié` | `No other linked characters` | No |

Companion test updates (not counted as findings): `BattleNetCharacterSwitcher.test.ts` expects for #2/#3 and score label.

---

## 2. Replacements owned by active branches

Do **not** land these on a parallel English-only PR without coordinating with the owning worktree.

### 2a. `feat/admin-shell-account-polish` (already editing)

| # | File | Approx. line / component | Current text (`main`) | Proposed English | Touched? |
|---|------|--------------------------|----------------------|------------------|----------|
| 6 | `apps/web/src/pages/AccountPage.vue` | L67 · `statusLabel` `REFRESHING` | `Actualisation en cours` | `Refreshing` (already in shell-account dirty diff) | **Yes — `feat/admin-shell-account-polish`** |
| 7 | `apps/web/src/pages/AccountPage.vue` | L75 · `statusLabel` `STALE` | `Données à actualiser` | `Stale` (already in shell-account dirty diff) | **Yes — `feat/admin-shell-account-polish`** |

### 2b. `feat/character-page-experience` (scope owner; clean worktree)

Refresh chrome on the character surface. Prefer aligning wording with AccountPage once shell-account lands (see §3).

| # | File | Approx. line / component | Current text | Proposed English (draft) | Touched? |
|---|------|--------------------------|--------------|--------------------------|----------|
| 8 | `apps/web/src/components/character/CharacterProfileToolbar.vue` | L20 · `refreshLabel` `REFRESHING` | `Actualisation en cours` | `Refreshing` or `Refresh in progress` | No (owned by character-page branch) |
| 9 | `apps/web/src/components/character/CharacterProfileToolbar.vue` | L22 · `refreshLabel` `STALE` | `Données à actualiser` | Align with §3 (`Stale` vs sentence form) | No |
| 10 | `apps/web/src/components/character/CharacterProfileToolbar.vue` | L24 · `refreshLabel` `QUEUED` | `Actualisation en cours` | Same as refreshing / `Queued` | No |
| 11 | `apps/web/src/pages/CharacterPage.vue` | L118 · `bannerTitles` | `Actualisation en cours` | Match banner title below | No |
| 12 | `apps/web/src/pages/CharacterPage.vue` | L122 · `bannerTitles` | `Données à actualiser` | Match banner title below | No |
| 13 | `apps/web/src/pages/CharacterPage.vue` | L344 · `StatusBanner` title | `Actualisation en cours` | `Refreshing` / `Refresh in progress` | No |
| 14 | `apps/web/src/pages/CharacterPage.vue` | L363 · `StatusBanner` title | `Données à actualiser` | Align with §3 | No |

`feat/admin-refresh-control-center` does not currently touch these files; treat it as a **terminology stakeholder** only (same refresh vocabulary across admin + character).

`feat-bulk-processing-ux` / `feat/admin-ability-catalog-polish`: no ownership of these findings.

---

## 3. Ambiguous terminology (product confirmation)

These are either French strings whose **English target is unsettled**, or English-adjacent UX that should be decided with the French fix so copy stays consistent.

| Topic | Related finding(s) | Options | Recommendation |
|-------|-------------------|---------|----------------|
| Missing Mythic+ score | #15 below | `Not calculated` · `No score` · `N/A` · `—` | Prefer **`No score`** or **`—`** in dense switcher rows; avoid literal “Not calculated” if Account page already omits the label when null |
| Refresh in progress | #6, #8, #10, #11, #13 | `Refreshing` · `Refresh in progress` · `Updating…` | Prefer **`Refreshing`** (matches shell-account + existing English button `Refreshing…`) |
| Stale snapshot | #7, #9, #12, #14 | `Stale` · `Outdated data` · `Data needs refresh` | Prefer **`Stale`** for chips; sentence titles may use **`Data may be outdated`** on banners — pick one family |
| Raw `FRESH` enum in toolbar | `CharacterProfileToolbar.vue` L25–26 | Keep `FRESH` · `Up to date` · hide when fresh | Not French; confirm whether enum leakage is acceptable |
| Locale autonyms | `realm-options.ts` | Keep native names · force English (`French`, `German`, …) | **Keep autonyms** (excluded above) unless product wants English-only chips |
| British `Analysing` on AccountPage | L65 | `Analysing` vs `Analyzing` | English either way; pick one locale for the product |

### Finding requiring confirmation before wording lock

| # | File | Approx. line / component | Current text | Proposed English (pending §3) | Touched by active branch? |
|---|------|--------------------------|--------------|-------------------------------|---------------------------|
| 15 | `apps/web/src/lib/accountCharacters.ts` | L27 · `formatAccountMythicScore` | `Non calculé` | TBD — see table above (`No score` / `—` / `Not calculated`) | No |

Used by `BattleNetCharacterSwitcher` option labels and visible score detail. Companion: `accountCharacters.test.ts`, `BattleNetCharacterSwitcher.test.ts`.

---

## Summary counts

| Group | Findings |
|-------|----------|
| 1. Safe standalone | **5** |
| 2. Owned by active branches | **9** (#6–#14) |
| 3. Ambiguous (also listed as finding) | **1** (#15) + terminology decisions for refresh/stale shared with #6–#14 |
| **Total non-English user-visible strings** | **15** |

---

## Long-term enforcement

### Lint / extraction test (recommended)

English-only product → **do not** introduce a full i18n framework yet. Prefer:

1. **CI smoke test** (Vitest or small Node script under `apps/web`) that:
   - Walks `apps/web/src/**/*.{vue,ts}` excluding `*.test.ts` if desired, or including them for assert sync.
   - Flags string literals / Vue text nodes matching:
     - Latin-1 letters with French diacritics (`[àâäéèêëïîôùûüç…]`), and/or
     - A small French lexicon (`\b(Aucun|Personnage|Données|Actualisation|calculé|Changer de)\b`, etc.).
   - Fails the job with file:line output.

2. **Allowlist file** e.g. `apps/web/i18n-allowlist.json` (or `docs/audits/english-allowlist.txt`) for:
   - WoW proper nouns (`Chérith`, dungeon/ability names if ever inlined),
   - Locale autonyms (`Français`, `Deutsch`, …) if product keeps them,
   - Intentional quotes from external APIs (rare; prefer mapping to English in the client).

3. **Optional ESLint** `no-restricted-syntax` / custom rule for template literals — heavier; the Vitest scan is enough for a small codebase.

### Test strategy

- Unit tests that assert **exact** UI copy must use the English strings after replacement (switcher + `formatAccountMythicScore`).
- One **copy contract test** (the scanner above) prevents regressions without screenshot brittleness.
- E2E should assert roles/`data-testid` + English titles only where banners are user-critical (`queued-banner`, `stale-banner`).

### Is a lightweight i18n layer warranted?

**Excessive for current English-only scope.** There is no second locale roadmap in product docs. A message catalog (`copy.ts` / `messages/en.ts`) is optional hygiene for shared status labels (`Refreshing` / `Stale`) so Account + Character + Toolbar stay in sync — that is a **constants module**, not vue-i18n. Revisit i18n only if a second locale is product-committed.

### Suggested fix ownership (post-audit)

| Work | Owner |
|------|--------|
| Switcher + `Non calculé` (#1–#5, #15) | Small standalone PR **or** fold into `feat/character-page-experience` |
| AccountPage (#6–#7) | Already on `feat/admin-shell-account-polish` — leave there |
| Character refresh titles (#8–#14) | `feat/character-page-experience`; align with shell’s `Refreshing` / `Stale` |
| Scanner + allowlist | Follow-up chore on `main` after copy lands |

---

## Audit metadata

| Field | Value |
|-------|--------|
| Document path | `docs/audits/frontend-english-only.md` |
| Base SHA inspected | `9dccc57` |
| Findings | 15 |
| Frontend production edits in this change | none |
