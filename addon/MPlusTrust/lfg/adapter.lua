local MPT = MPlusTrust

MPT.LFGAdapter = MPT.LFGAdapter or {}
local Adapter = MPT.LFGAdapter

Adapter.listeners = Adapter.listeners or {}
Adapter.hooked = Adapter.hooked or false

function Adapter.Register(event, callback)
  Adapter.listeners[event] = Adapter.listeners[event] or {}
  table.insert(Adapter.listeners[event], callback)
end

function Adapter.Emit(event, ...)
  local listeners = Adapter.listeners[event]
  if not listeners then
    return
  end
  for _, callback in ipairs(listeners) do
    local ok, err = pcall(callback, ...)
    if not ok and MPT.GetSetting("debug") then
      print("|cff33ccffMPlusTrust:|r adapter error:", err)
    end
  end
end

local function safeHook(name, handler)
  if type(_G[name]) ~= "function" then
    return false
  end
  if hooksecurefunc then
    hooksecurefunc(name, handler)
    return true
  end
  return false
end

function Adapter.TryHookApplicantMember()
  if Adapter.hooked then
    return true
  end
  if InCombatLockdown and InCombatLockdown() then
    return false
  end

  local hooked = safeHook("LFGListApplicationViewer_UpdateApplicantMember", function(button, memberIdx)
    if not button then
      return
    end
    local applicantIdx = button:GetParent() and button:GetParent().applicantID
    Adapter.Emit("OnApplicantMemberUpdated", button, memberIdx, applicantIdx)
  end)

  if hooked then
    Adapter.hooked = true
  end
  return hooked
end

function Adapter.Init()
  local frame = CreateFrame("Frame")
  frame:RegisterEvent("ADDON_LOADED")
  frame:RegisterEvent("PLAYER_ENTERING_WORLD")
  frame:SetScript("OnEvent", function(_, event)
    if event == "ADDON_LOADED" then
      Adapter.TryHookApplicantMember()
    elseif event == "PLAYER_ENTERING_WORLD" then
      Adapter.TryHookApplicantMember()
    end
  end)
end

Adapter.Init()
