local MPT = MPlusTrust

MPT.Tooltip = MPT.Tooltip or {}

local Tooltip = MPT.Tooltip
Tooltip.hooksRegistered = Tooltip.hooksRegistered or false

local function profileUrl(region, realm, name)
  local website = "https://example.invalid/mplus-trust-factor"
  local tocWebsite = GetAddOnMetadata and GetAddOnMetadata("MPlusTrust", "X-Website")
  if tocWebsite and tocWebsite ~= "" then
    website = tocWebsite
  end
  local r = MPT.NormalizeRegion(region) or "EU"
  local rl = MPT.NormalizeRealm(realm) or "unknown"
  local n = name or "unknown"
  return string.format("%s/character/%s/%s/%s", website, string.lower(r), rl, n)
end

function Tooltip.BuildLines(region, realm, name)
  if not MPT.GetSetting("showTooltip") then
    return nil
  end

  local summary, reason = MPT.LookupSummary(region, realm, name)
  if not summary then
    if MPT.GetSetting("debug") then
      return { "M+ Trust Factor", "No data (" .. tostring(reason) .. ")" }
    end
    return nil
  end

  if summary.confidenceBucket < MPT.GetSetting("minConfidenceBucket") then
    return nil
  end

  local lines = { "M+ Trust Factor" }
  if MPT.GetSetting("showNumericScore") then
    table.insert(lines, string.format("Trust Factor: %d (%s)", summary.score, summary.grade))
  else
    table.insert(lines, string.format("Grade: %s", summary.grade))
  end
  table.insert(
    lines,
    "Confidence: " .. (MPT.CONFIDENCE_LABELS[summary.confidenceBucket] or "Unknown")
  )

  local meta = MPT.GetMeta()
  table.insert(
    lines,
    "Updated: " .. MPT.FormatFreshness(summary.freshnessDays, meta and meta.generatedAt)
  )

  local flags = MPT.DecodeRedFlags(summary.redFlags)
  for _, flag in ipairs(flags) do
    table.insert(lines, "|cffff6666" .. flag .. "|r")
  end

  table.insert(lines, "|cff999999Ctrl+C to copy profile URL|r")
  return lines, summary, profileUrl(region, realm, name)
end

function Tooltip.Attach(frame, region, realm, name)
  if not frame or not MPT.GetSetting("showTooltip") then
    return
  end

  frame:HookScript("OnEnter", function(self)
    local lines, summary, url = Tooltip.BuildLines(region, realm, name)
    if not lines then
      return
    end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:ClearLines()
    for _, line in ipairs(lines) do
      GameTooltip:AddLine(line)
    end
    if summary and url then
      self.mptProfileUrl = url
    end
    GameTooltip:Show()
  end)

  frame:HookScript("OnLeave", function(self)
    self.mptProfileUrl = nil
    GameTooltip:Hide()
  end)
end

function Tooltip.OnApplicantMember(button, memberIdx, applicantIdx)
  if not button or not MPT.GetSetting("showTooltip") then
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

  if button.mptTooltipHooked then
    return
  end
  button.mptTooltipHooked = true
  Tooltip.Attach(button, "EU", realm, name)
end

function Tooltip.RegisterWithAdapter()
  if Tooltip.hooksRegistered then
    return
  end
  Tooltip.hooksRegistered = true
  if MPT.LFGAdapter and MPT.LFGAdapter.Register then
    MPT.LFGAdapter.Register("OnApplicantMemberUpdated", function(button, memberIdx, applicantIdx)
      Tooltip.OnApplicantMember(button, memberIdx, applicantIdx)
    end)
  end
end
