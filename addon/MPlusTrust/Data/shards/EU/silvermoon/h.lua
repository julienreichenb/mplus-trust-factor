MPT_SHARDS = MPT_SHARDS or {}
local shardKey = "EU/silvermoon/h"
local t = MPT_SHARDS[shardKey] or {}
MPT_SHARDS[shardKey] = t
t["EU:silvermoon:healbot"] = { 79, 3, 2, 16, 0, "heal01" }
return t
