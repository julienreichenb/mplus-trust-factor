# LFG hook safety

## Goals

1. Show Trust Factor in tooltip on applicant hover (primary).
2. Optionally show a compact grade on the applicant row (experimental).
3. Never taint secure actions or replace Blizzard behavior.

## Adapter design

`addon/MPlusTrust/lfg/adapter.lua`:

- Probes for `LFGListApplicationViewer_UpdateApplicantMember`.
- Registers **one** `hooksecurefunc` handler.
- Emits `OnApplicantMemberUpdated(button, memberIdx, applicantIdx)` to subscribers.
- No-ops when the global is missing (dungeon tools not loaded, ptr build differences).

Subscribers:

| Module | Behavior |
|--------|----------|
| `tooltip.lua` | Attaches `OnEnter`/`OnLeave` once per button; builds `GameTooltip` lines |
| `lfg/row_grade.lua` | Creates a right-aligned `FontString`; hidden unless `showRowGrade` setting is enabled |

## Safe patterns used

```lua
hooksecurefunc("LFGListApplicationViewer_UpdateApplicantMember", function(button, memberIdx)
  -- read-only inspection + cosmetic overlay
end)
```

```lua
frame:HookScript("OnEnter", function()
  GameTooltip:SetOwner(frame, "ANCHOR_RIGHT")
  -- add lines
end)
```

## Unsafe patterns avoided

- Replacing `LFGListApplicationViewer` templates.
- Calling `SetItemRef` or external URLs automatically.
- HTTP from Lua.
- Frame polling every `OnUpdate`.
- Executing `/invite` or other protected slash commands.

## Fallback matrix

| Condition | Tooltip | Row grade |
|-----------|---------|-----------|
| Hook unavailable | `/mpt lookup Name-Realm` | Hidden |
| Character not in dataset | No tooltip (debug shows reason) | Hidden |
| `showTooltip = false` | Disabled | N/A |
| `showRowGrade = false` (default) | Works | Hidden |
| `InCombatLockdown()` | Works (hover) | Skips update |

## User settings

- `showRowGrade` default **false** — enable with `/mpt row on`.
- `showTooltip` default **true**.
- `minConfidenceBucket` filters low-confidence matches.

## Testing without the game client

- Lua syntax check: `pnpm --filter @mplus/addon-exporter lua:check`
- Lookup vectors: `MPT_TEST_VECTORS` + `/mpt debug`
- Adapter loads without error when LFG globals are absent (unit-style manual checklist).
