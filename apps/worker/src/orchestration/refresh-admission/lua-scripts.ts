/**
 * Atomic admission Lua (foundation artifact).
 *
 * Not executed on the live refresh path while REFRESH_ADMISSION_MODE != enforce
 * or REFRESH_CONCURRENCY_ENABLED is false. Kept here so later stages can EVAL
 * the same script without inventing a parallel primitive.
 *
 * KEYS:
 *  1 sched:state
 *  2 wcl:snap
 *  3 wcl:{windowId}:reserved:total
 *  4 wcl:{windowId}:res
 *  5 wcl:lease
 *  6 slot:owners
 *  7 slot:lease
 *  8 slot:count
 *
 * ARGV:
 *  1 ingestionJobId
 *  2 estimatedPoints (int)
 *  3 emergency (0|1)
 *  4 globalLimit (int)
 *  5 leaseExpiryMs (int)
 *  6 expectedWindowId
 *  7 nowMs
 *  8 maxSnapshotAgeMs
 *  9 allowSchedulingStates (comma-separated, e.g. RUNNING)
 */

export const REFRESH_ADMISSION_RESERVE_LUA = `
local schedKey = KEYS[1]
local snapKey = KEYS[2]
local totalKey = KEYS[3]
local resKey = KEYS[4]
local leaseZ = KEYS[5]
local slotOwners = KEYS[6]
local slotLease = KEYS[7]
local slotCountKey = KEYS[8]

local jobId = ARGV[1]
local estimated = tonumber(ARGV[2])
local emergency = tonumber(ARGV[3])
local globalLimit = tonumber(ARGV[4])
local leaseExpiry = tonumber(ARGV[5])
local expectedWindow = ARGV[6]
local nowMs = tonumber(ARGV[7])
local maxAgeMs = tonumber(ARGV[8])
local allowStates = ARGV[9]

local state = redis.call('GET', schedKey)
if not state then state = 'RUNNING' end
local allowed = false
for token in string.gmatch(allowStates, '[^,]+') do
  if token == state then allowed = true break end
end
if not allowed then
  return {0, 'SCHEDULING_PAUSED', state}
end

local snap = redis.call('HMGET', snapKey, 'pointsRemaining', 'pointsLimit', 'fetchedAt', 'windowId')
local pointsRemaining = tonumber(snap[1])
local pointsLimit = tonumber(snap[2])
local fetchedAt = tonumber(snap[3])
local windowId = snap[4]
if pointsRemaining == nil or pointsLimit == nil or fetchedAt == nil then
  return {0, 'SNAPSHOT_MISSING', ''}
end
if nowMs - fetchedAt > maxAgeMs then
  return {0, 'SNAPSHOT_STALE', ''}
end
if windowId == false or windowId == nil or windowId ~= expectedWindow then
  return {0, 'WINDOW_ID_MISSING', tostring(windowId)}
end
if pointsLimit ~= pointsLimit or pointsLimit <= 0 then
  return {0, 'POINTS_LIMIT_INVALID', ''}
end

local existing = redis.call('HGET', resKey, jobId)
if existing then
  local heldSlot = redis.call('HEXISTS', slotOwners, jobId)
  return {1, 'IDEMPOTENT_EXISTING', tonumber(existing), heldSlot}
end

local activeReserved = tonumber(redis.call('GET', totalKey) or '0') or 0
local fractionReserve = math.floor(pointsLimit * tonumber(ARGV[10] or '0.1'))
local minReserve = tonumber(ARGV[11] or '50') or 50
local emergencyReserve = math.max(fractionReserve, minReserve)
local available
if emergency == 1 then
  available = math.max(0, pointsRemaining - activeReserved)
else
  available = math.max(0, pointsRemaining - emergencyReserve - activeReserved)
end
if estimated > 0 and available < estimated then
  return {0, 'INSUFFICIENT_RESERVED_CAPACITY', available}
end

local currentSlots = tonumber(redis.call('GET', slotCountKey) or '0') or 0
local hasSlot = redis.call('HEXISTS', slotOwners, jobId) == 1
if not hasSlot then
  if currentSlots >= globalLimit then
    return {0, 'INSUFFICIENT_GLOBAL_SLOTS', currentSlots}
  end
  redis.call('HSET', slotOwners, jobId, tostring(leaseExpiry))
  redis.call('ZADD', slotLease, leaseExpiry, jobId)
  redis.call('INCR', slotCountKey)
end

if estimated > 0 then
  redis.call('HSET', resKey, jobId, tostring(estimated))
  redis.call('INCRBY', totalKey, estimated)
  redis.call('ZADD', leaseZ, leaseExpiry, jobId)
end

return {1, 'OK', estimated, emergencyReserve, available}
`.trim();

export const REFRESH_ADMISSION_RELEASE_LUA = `
local totalKey = KEYS[1]
local resKey = KEYS[2]
local leaseZ = KEYS[3]
local slotOwners = KEYS[4]
local slotLease = KEYS[5]
local slotCountKey = KEYS[6]
local jobId = ARGV[1]

local existing = redis.call('HGET', resKey, jobId)
local releasedPoints = 0
if existing then
  releasedPoints = tonumber(existing) or 0
  redis.call('HDEL', resKey, jobId)
  if releasedPoints > 0 then
    redis.call('DECRBY', totalKey, releasedPoints)
  end
  redis.call('ZREM', leaseZ, jobId)
end

local hadSlot = redis.call('HDEL', slotOwners, jobId)
if hadSlot == 1 then
  redis.call('ZREM', slotLease, jobId)
  local count = tonumber(redis.call('GET', slotCountKey) or '0') or 0
  if count > 0 then
    redis.call('DECR', slotCountKey)
  end
end

return {1, 'RELEASED', releasedPoints, hadSlot}
`.trim();
