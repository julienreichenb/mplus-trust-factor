-- MPlusTrust: consumes generated static datasets only. No HTTP from Lua.
MPlusTrust = MPlusTrust or {}

local MPT = MPlusTrust
local ADDON_NAME = ...

function MPT.OnAddonLoaded()
  MPT.InitSettings()
  MPT.RegisterCommands()
  if MPT.Tooltip and MPT.Tooltip.RegisterWithAdapter then
    MPT.Tooltip.RegisterWithAdapter()
  end
  if MPT.GetSetting("debug") then
    local ok, failed = MPT.RunLookupTests()
  if not ok then
      print("|cff33ccffMPlusTrust:|r lookup self-test failed:", failed)
    end
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:SetScript("OnEvent", function(_, event, name)
  if event == "ADDON_LOADED" and name == ADDON_NAME then
    MPT.OnAddonLoaded()
  end
end)

-- Backward-compatible helper used by tests and external callers.
function MPlusTrust.GetGrade(region, realm, name)
  local summary = MPT.LookupSummary(region, realm, name)
  if not summary then
    return nil
  end
  return summary.grade
end
