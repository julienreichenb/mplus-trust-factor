local MPT = MPlusTrust

MPT.RowGrade = MPT.RowGrade or {}
local RowGrade = MPT.RowGrade

RowGrade.fontStrings = RowGrade.fontStrings or {}

local function ensureFontString(button)
  if RowGrade.fontStrings[button] then
    return RowGrade.fontStrings[button]
  end
  if not button or not button.CreateFontString then
    return nil
  end
  local fs = button:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  fs:SetPoint("RIGHT", button, "RIGHT", -4, 0)
  fs:SetJustifyH("RIGHT")
  RowGrade.fontStrings[button] = fs
  return fs
end

function RowGrade.Update(button, region, realm, name)
  local fs = ensureFontString(button)
  if not fs then
    return
  end

  if not MPT.GetSetting("showRowGrade") then
    fs:Hide()
    return
  end

  if InCombatLockdown and InCombatLockdown() then
    return
  end

  local summary = MPT.LookupSummary(region or "EU", realm, name)
  if not summary then
    fs:Hide()
    return
  end

  if summary.confidenceBucket < MPT.GetSetting("minConfidenceBucket") then
    fs:Hide()
    return
  end

  local text = summary.grade
  if MPT.GetSetting("showNumericScore") then
    text = string.format("%s %d", summary.grade, summary.score)
  end
  fs:SetText("|cff33ccff" .. text .. "|r")
  fs:Show()
end

function RowGrade.OnApplicantMember(button, memberIdx, applicantIdx)
  if not MPT.GetSetting("showRowGrade") then
    return
  end

  local name, realm
  if C_LFGList and C_LFGList.GetApplicantMemberInfo then
    local info = { C_LFGList.GetApplicantMemberInfo(applicantIdx, memberIdx) }
    name = info[1]
    realm = info[2]
  end
  if (not name or not realm) and button.name then
    name = button.name
    realm = button.realm
  end
  if not name or not realm then
    return
  end
  RowGrade.Update(button, "EU", realm, name)
end

function RowGrade.Refresh()
  for button, fs in pairs(RowGrade.fontStrings) do
    if fs then
      fs:Hide()
    end
  end
end

function RowGrade.RegisterWithAdapter()
  if RowGrade.registered then
    return
  end
  RowGrade.registered = true
  if MPT.LFGAdapter and MPT.LFGAdapter.Register then
    MPT.LFGAdapter.Register("OnApplicantMemberUpdated", function(button, memberIdx, applicantIdx)
      RowGrade.OnApplicantMember(button, memberIdx, applicantIdx)
    end)
  end
end

RowGrade.RegisterWithAdapter()
