-- MPlusTrust: consumes generated static datasets only. No HTTP from Lua.
MPlusTrust = MPlusTrust or {}

local ADDON_NAME = ...

function MPlusTrust.GetGrade(_region, _realm, _name)
  -- Agent 7 owns lookup against exported shards.
  return nil
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:SetScript("OnEvent", function(_, event, name)
  if event == "ADDON_LOADED" and name == ADDON_NAME then
    MPlusTrustDB = MPlusTrustDB or {}
  end
end)
