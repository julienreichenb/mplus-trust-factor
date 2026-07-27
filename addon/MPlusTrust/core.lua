-- MPlusTrust: consumes generated static datasets only. No HTTP from Lua.
MPlusTrust = MPlusTrust or {}

local function normalizeKey(region, realm, name)
  return string.lower(region .. "|" .. realm .. "|" .. name)
end

function MPlusTrust.GetGrade(region, realm, name)
  if not MPlusTrustDB or not MPlusTrustDB.grades then
    return nil
  end
  local key = normalizeKey(region, realm, name)
  local entry = MPlusTrustDB.grades[key]
  if not entry then
    return nil
  end
  return entry.grade, entry.score, entry.confidence
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:SetScript("OnEvent", function(_, event, name)
  if event == "ADDON_LOADED" and name == ADDON_NAME then
    MPlusTrustDB = MPlusTrustDB or {}
  end
end)
