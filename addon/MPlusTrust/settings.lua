local MPT = MPlusTrust

local DEFAULTS = {
  settingsVersion = MPT.SETTINGS_VERSION,
  showRowGrade = false,
  showTooltip = true,
  showNumericScore = true,
  minConfidenceBucket = 0,
  debug = false,
}

function MPT.InitSettings()
  MPlusTrustDB = MPlusTrustDB or {}
  local db = MPlusTrustDB

  if not db.settingsVersion or db.settingsVersion < MPT.SETTINGS_VERSION then
    for key, value in pairs(DEFAULTS) do
      if db[key] == nil then
        db[key] = value
      end
    end
    db.settingsVersion = MPT.SETTINGS_VERSION
  end

  return db
end

function MPT.GetSetting(key)
  local db = MPT.InitSettings()
  if db[key] ~= nil then
    return db[key]
  end
  return DEFAULTS[key]
end

function MPT.SetSetting(key, value)
  local db = MPT.InitSettings()
  db[key] = value
end
