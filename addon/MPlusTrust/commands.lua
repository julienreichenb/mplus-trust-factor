local MPT = MPlusTrust

local function printLine(message)
  DEFAULT_CHAT_FRAME:AddMessage("|cff33ccffMPlusTrust:|r " .. tostring(message))
end

local function formatSummary(summary)
  if not summary then
    return "No data"
  end
  local confidence = MPT.CONFIDENCE_LABELS[summary.confidenceBucket] or "Unknown"
  local meta = MPT.GetMeta()
  local freshness = MPT.FormatFreshness(summary.freshnessDays, meta and meta.generatedAt)
  local lines = {
    string.format("Grade %s (%d)", summary.grade, summary.score),
    "Confidence: " .. confidence,
    "Freshness: " .. freshness,
  }
  local flags = MPT.DecodeRedFlags(summary.redFlags)
  if #flags > 0 then
    table.insert(lines, "Flags: " .. table.concat(flags, ", "))
  end
  if meta then
    table.insert(
      lines,
      string.format(
        "Model %s v%s",
        tostring(meta.scoreModelKey),
        tostring(meta.scoreModelVersion)
      )
    )
  end
  return table.concat(lines, "\n")
end

function MPT.PrintStatus()
  local meta = MPT.GetMeta()
  if not meta then
    printLine("No dataset loaded.")
    return
  end
  printLine(
    string.format(
      "Dataset v%s | %s | %s | %d characters | checksum %s",
      tostring(meta.formatVersion),
      tostring(meta.region),
      tostring(meta.season),
      tonumber(meta.characterCount) or 0,
      string.sub(tostring(meta.checksum), 1, 12)
    )
  )
  printLine(
    string.format(
      "Generated %s | model %s@%s",
      tostring(meta.generatedAt),
      tostring(meta.scoreModelKey),
      tostring(meta.scoreModelVersion)
    )
  )
end

function MPT.LookupCommand(region, realm, name)
  if not realm or not name then
    printLine("Usage: /mpt lookup Name-Realm")
    return
  end

  local lookupRegion = MPT.NormalizeRegion(region) or "EU"
  local summary, reason = MPT.LookupSummary(lookupRegion, realm, name)
  if not summary then
    printLine(string.format("No record for %s-%s (%s)", name, realm, tostring(reason)))
    return
  end
  printLine(string.format("%s-%s", name, realm))
  for line in string.gmatch(formatSummary(summary), "[^\n]+") do
    printLine(line)
  end
end

function MPT.ToggleDebug()
  local nextValue = not MPT.GetSetting("debug")
  MPT.SetSetting("debug", nextValue)
  printLine("Debug mode " .. (nextValue and "enabled" or "disabled"))
end

function MPT.PrintDebug()
  printLine("Debug:")
  printLine(" showRowGrade=" .. tostring(MPT.GetSetting("showRowGrade")))
  printLine(" showTooltip=" .. tostring(MPT.GetSetting("showTooltip")))
  printLine(" showNumericScore=" .. tostring(MPT.GetSetting("showNumericScore")))
  printLine(" minConfidenceBucket=" .. tostring(MPT.GetSetting("minConfidenceBucket")))
  local ok, failedKey = MPT.RunLookupTests()
  printLine(" lookup tests=" .. (ok and "pass" or ("fail @" .. tostring(failedKey))))
end

function MPT.RegisterCommands()
  SLASH_MPLUSTRUST1 = "/mpt"
  SLASH_MPLUSTRUST2 = "/mplustrust"
  SlashCmdList["MPLUSTRUST"] = function(msg)
    local command, rest = msg:match("^(%S*)%s*(.-)$")
    command = string.lower(command or "")

    if command == "" or command == "status" then
      MPT.PrintStatus()
    elseif command == "lookup" then
      local nameRealm = rest:match("^(%S+)")
      if not nameRealm then
        printLine("Usage: /mpt lookup Name-Realm")
        return
      end
      local charName, realm = nameRealm:match("^(.+)%-(.+)$")
      if not charName or not realm then
        printLine("Usage: /mpt lookup Name-Realm")
        return
      end
      MPT.LookupCommand("EU", realm, charName)
    elseif command == "debug" then
      if rest == "on" or rest == "off" then
        MPT.SetSetting("debug", rest == "on")
        printLine("Debug mode " .. rest)
      else
        MPT.ToggleDebug()
        MPT.PrintDebug()
      end
    elseif command == "row" then
      local enabled = rest == "on"
      MPT.SetSetting("showRowGrade", enabled)
      printLine("Row grade " .. (enabled and "enabled (experimental)" or "disabled"))
      if MPT.RowGrade and MPT.RowGrade.Refresh then
        MPT.RowGrade.Refresh()
      end
    elseif command == "tooltip" then
      local enabled = rest ~= "off"
      MPT.SetSetting("showTooltip", enabled)
      printLine("Tooltip " .. (enabled and "enabled" or "disabled"))
    else
      printLine("Commands: status | lookup Name-Realm | debug | row on|off | tooltip on|off")
    end
  end
end
