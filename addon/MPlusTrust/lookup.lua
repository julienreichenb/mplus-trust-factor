local MPT = MPlusTrust

MPT.shardCache = MPT.shardCache or {}

function MPT.GetMeta()
  return MPT_EXPORT_META
end

function MPT.IsDatasetLoaded()
  return MPT_EXPORT_META ~= nil
end

function MPT.IsDatasetStale()
  local meta = MPT.GetMeta()
  if not meta or not meta.generatedAt then
    return true
  end
  return false
end

local function getShardTable(region, realm, normalizedName)
  local bucket = MPT.ShardBucket(normalizedName)
  local realmKey = MPT.NormalizeRealm(realm)
  local regionKey = MPT.NormalizeRegion(region)
  local cacheKey = regionKey .. "/" .. realmKey .. "/" .. bucket

  if MPT.shardCache[cacheKey] then
    return MPT.shardCache[cacheKey]
  end

  if MPT_SHARDS and MPT_SHARDS[cacheKey] then
    MPT.shardCache[cacheKey] = MPT_SHARDS[cacheKey]
    return MPT.shardCache[cacheKey]
  end

  return nil
end

function MPT.LookupRecord(region, realm, name)
  local key = MPT.BuildLookupKey(region, realm, name)
  if not key then
    return nil, "invalid_identity"
  end

  local normalizedName = MPT.NormalizeName(name)
  local shard = getShardTable(region, realm, normalizedName)
  if not shard then
    if MPT_TEST_VECTORS and MPT_TEST_VECTORS[key] then
      return MPT_TEST_VECTORS[key], key
    end
    return nil, "shard_missing"
  end

  local record = shard[key]
  if not record and MPT_TEST_VECTORS then
    record = MPT_TEST_VECTORS[key]
  end
  if not record then
    return nil, "not_found"
  end
  return record, key
end

function MPT.LookupSummary(region, realm, name)
  local record, keyOrReason = MPT.LookupRecord(region, realm, name)
  if not record then
    return nil, keyOrReason
  end

  local grade = MPT.GRADE_CODE_TO_LETTER[record[2]] or "?"
  local summary = {
    key = keyOrReason,
    score = record[1],
    grade = grade,
    confidenceBucket = record[3],
    redFlags = record[4],
    freshnessDays = record[5],
    profileKey = record[6],
  }
  return summary
end

function MPT.RunLookupTests()
  if not MPT_TEST_VECTORS then
    return false, "missing_test_vectors"
  end
  for key, expected in pairs(MPT_TEST_VECTORS) do
    local parts = { strsplit(":", key) }
    local region, realm, charName = parts[1], parts[2], parts[3]
    local record = MPT.LookupRecord(region, realm, charName)
    if not record or record[1] ~= expected[1] or record[2] ~= expected[2] then
      return false, key
    end
  end
  return true
end
