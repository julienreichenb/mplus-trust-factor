local MPT = MPlusTrust

MPT.GRADE_CODE_TO_LETTER = {
  [5] = "S",
  [4] = "A",
  [3] = "B",
  [2] = "C",
  [1] = "D",
}

MPT.CONFIDENCE_LABELS = {
  [0] = "Low",
  [1] = "Moderate",
  [2] = "Good",
  [3] = "High",
}

MPT.RED_FLAG_BITS = {
  [1] = "Boost suspected",
  [2] = "Atypical progression",
  [4] = "Logs hidden",
  [8] = "Insufficient data",
  [16] = "Probable reroll",
  [32] = "Confirmed reroll",
}

MPT.ADDON_VERSION = "0.1.0"
MPT.SETTINGS_VERSION = 1

function MPT.NormalizeRegion(region)
  if not region then
    return nil
  end
  return string.upper(region)
end

function MPT.NormalizeRealm(realm)
  if not realm then
    return nil
  end
  return string.lower(realm)
end

function MPT.NormalizeName(name)
  if not name then
    return nil
  end
  return string.lower(name)
end

function MPT.BuildLookupKey(region, realm, name)
  local r = MPT.NormalizeRegion(region)
  local rl = MPT.NormalizeRealm(realm)
  local n = MPT.NormalizeName(name)
  if not r or not rl or not n or n == "" then
    return nil
  end
  return r .. ":" .. rl .. ":" .. n
end

function MPT.ShardBucket(normalizedName)
  if not normalizedName or normalizedName == "" then
    return "_"
  end
  local first = string.sub(normalizedName, 1, 1)
  if string.match(first, "[%a%d]") then
    return first
  end
  return "_"
end

function MPT.DecodeRedFlags(bitset)
  local flags = {}
  if not bitset or bitset == 0 then
    return flags
  end
  for bit, label in pairs(MPT.RED_FLAG_BITS) do
    if bitband(bitset, bit) == bit then
      table.insert(flags, label)
    end
  end
  table.sort(flags)
  return flags
end

function MPT.FormatFreshness(freshnessDays, generatedAt)
  if freshnessDays and freshnessDays > 90 then
    return "Stale dataset"
  end
  if freshnessDays and freshnessDays > 0 then
    return string.format("%d day(s) old", freshnessDays)
  end
  if generatedAt then
    return "Current export"
  end
  return "Unknown"
end
