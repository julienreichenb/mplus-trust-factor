MPT_SHARDS = MPT_SHARDS or {}
local shardKey = "EU/stormrage/t"
local t = MPT_SHARDS[shardKey] or {}
MPT_SHARDS[shardKey] = t
t["EU:stormrage:tankmain"] = { 84, 4, 3, 0, 0, "tank01" }
return t
