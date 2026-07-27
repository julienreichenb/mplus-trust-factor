# Current Retail API research (Group Finder)

> Research date: 2026-07-27. Re-verify before each major WoW patch.

## Applicant list surfaces

| API / frame | Purpose | Notes |
|-------------|---------|-------|
| `LFGListApplicationViewer` | Parent frame for premade group applicants | Loaded with Premade Groups UI |
| `LFGListApplicationViewer_UpdateApplicantMember` | Blizzard global that paints each member row | Stable `hooksecurefunc` target |
| `C_LFGList.GetApplicantMemberInfo(applicantID, memberIdx)` | Returns name, realm, class, spec, item level | Preferred identity source when available |
| Applicant member button fields | `button.name`, `button.realm` | Fallback when C_LFGList payload missing |
| `GameTooltip` | Hover presentation | Safe for read-only enrichment |

## Events

| Event | Usage |
|-------|-------|
| `ADDON_LOADED` | Register hooks after our addon loads |
| `PLAYER_ENTERING_WORLD` | Retry hook if LFG globals were not yet defined |

We intentionally avoid polling loops; hooks fire when Blizzard refreshes applicant rows.

## Secure / protected boundaries

- LFG list buttons may participate in secure action routing during certain flows.
- **Do not** call `SetAttribute`, `RegisterForClicks`, or replace click handlers on applicant buttons.
- **Do not** create clickable overlay buttons on secure templates during combat (`InCombatLockdown()`).
- Cosmetic `FontString` overlays created as children are used cautiously and gated behind a setting.

## Combat lockdown

Group Finder is usually opened out of combat. The adapter skips row mutations when `InCombatLockdown()` returns true.

## Localization

MVP strings are English in `constants.lua`. Future: load per-locale files; rely on Blizzard globals for class/spec where possible.

## Third-party UI compatibility

Hooks observe Blizzard globals rather than replacing frames, reducing conflict risk with ElvUI, NDui, etc. Row FontStrings anchor to the right edge of the default member button.

## References

- [Warcraft Wiki — Group Finder](https://warcraft.wiki.gg/wiki/Looking_For_Group)
- [Blizzard API — C_LFGList](https://warcraft.wiki.gg/wiki/API_C_LFGList)
- Community pattern: `hooksecurefunc("LFGListApplicationViewer_UpdateApplicantMember", ...)`
