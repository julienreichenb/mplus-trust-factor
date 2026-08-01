/**
 * Atomic admission Lua scripts.
 *
 * Executed when REFRESH_ADMISSION_MODE=enforce.
 *
 * Ownership / idempotency (must match classifyAdmissionOwnership +
 * simulateReserveLuaOwnershipBranch):
 * - reservation + slot → IDEMPOTENT_EXISTING (ok)
 * - reservation without slot → INCONSISTENT_RESERVATION_WITHOUT_SLOT (reject)
 * - slot without reservation → continue WCL capacity checks; acquire reservation
 *   if needed (do not treat as idempotent success)
 * - non-WCL (estimated==0): slot-only; snapshot not required
 *
 * KEYS (reserve):
 *  1 sched:state
 *  2 wcl:snap
 *  3 wcl:{windowId}:reserved:total
 *  4 wcl:{windowId}:res
 *  5 wcl:lease
 *  6 slot:owners
 *  7 slot:lease
 *  8 slot:count
 *  9 job:{id}:window
 *
 * ARGV: see REFRESH_ADMISSION_RESERVE_ARGV
 */

/** Documented ARGV contract for REFRESH_ADMISSION_RESERVE_LUA (1-based). */
export const REFRESH_ADMISSION_RESERVE_ARGV = [
  { index: 1, name: "ingestionJobId", description: "IngestionJob.id (slot/reservation owner)" },
  { index: 2, name: "estimatedPoints", description: "Integer WCL points to reserve (0 = non-WCL)" },
  { index: 3, name: "emergency", description: "0 = normal lane, 1 = emergency lane" },
  { index: 4, name: "globalLimit", description: "Effective global concurrency clamp" },
  { index: 5, name: "leaseExpiryMs", description: "Lease expiry timestamp (ms)" },
  { index: 6, name: "expectedWindowId", description: "Window id derived from WCL resetAt (empty for non-WCL)" },
  { index: 7, name: "nowMs", description: "Current time (ms)" },
  { index: 8, name: "maxSnapshotAgeMs", description: "Fail closed when snapshot older than this" },
  {
    index: 9,
    name: "allowSchedulingStates",
    description: "Comma-separated allow-set (e.g. RUNNING)",
  },
  {
    index: 10,
    name: "safetyReserveFraction",
    description: "Fraction of pointsLimit used for emergency reserve (e.g. 0.1)",
  },
  {
    index: 11,
    name: "minEmergencyReservePoints",
    description: "Integer floor for emergency reserve points",
  },
] as const;

export const REFRESH_ADMISSION_RESERVE_LUA = `
local schedKey = KEYS[1]
local snapKey = KEYS[2]
local totalKey = KEYS[3]
local resKey = KEYS[4]
local leaseZ = KEYS[5]
local slotOwners = KEYS[6]
local slotLease = KEYS[7]
local slotCountKey = KEYS[8]
local jobWindowKey = KEYS[9]

local jobId = ARGV[1]
local estimated = tonumber(ARGV[2])
local emergency = tonumber(ARGV[3])
local globalLimit = tonumber(ARGV[4])
local leaseExpiry = tonumber(ARGV[5])
local expectedWindow = ARGV[6]
local nowMs = tonumber(ARGV[7])
local maxAgeMs = tonumber(ARGV[8])
local allowStates = ARGV[9]
local safetyReserveFraction = tonumber(ARGV[10])
local minEmergencyReservePoints = tonumber(ARGV[11])
if safetyReserveFraction == nil then safetyReserveFraction = 0.1 end
if minEmergencyReservePoints == nil then minEmergencyReservePoints = 50 end
if estimated == nil then estimated = 0 end

local state = redis.call('GET', schedKey)
if not state then state = 'RUNNING' end
local allowed = false
for token in string.gmatch(allowStates, '[^,]+') do
  if token == state then allowed = true break end
end
if not allowed then
  return {0, 'SCHEDULING_PAUSED', state}
end

-- Non-WCL / zero-estimate: global slot only (no snapshot / no reservation).
if estimated <= 0 then
  local hasSlot = redis.call('HEXISTS', slotOwners, jobId) == 1
  if hasSlot then
    redis.call('HSET', slotOwners, jobId, tostring(leaseExpiry))
    redis.call('ZADD', slotLease, leaseExpiry, jobId)
    return {1, 'IDEMPOTENT_EXISTING', 0, 1}
  end
  local currentSlots = tonumber(redis.call('GET', slotCountKey) or '0') or 0
  if currentSlots >= globalLimit then
    return {0, 'INSUFFICIENT_GLOBAL_SLOTS', currentSlots}
  end
  redis.call('HSET', slotOwners, jobId, tostring(leaseExpiry))
  redis.call('ZADD', slotLease, leaseExpiry, jobId)
  redis.call('INCR', slotCountKey)
  return {1, 'OK', 0, 0, 0}
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

-- Ownership branch (aligned with classifyAdmissionOwnership):
-- full pair → idempotent; reservation without slot → reject; bare slot → continue.
local existing = redis.call('HGET', resKey, jobId)
if existing then
  local heldSlot = redis.call('HEXISTS', slotOwners, jobId)
  if heldSlot == 1 then
    redis.call('HSET', slotOwners, jobId, tostring(leaseExpiry))
    redis.call('ZADD', slotLease, leaseExpiry, jobId)
    redis.call('ZADD', leaseZ, leaseExpiry, jobId)
    redis.call('SET', jobWindowKey, windowId)
    return {1, 'IDEMPOTENT_EXISTING', tonumber(existing), 1}
  end
  return {0, 'INCONSISTENT_RESERVATION_WITHOUT_SLOT', tonumber(existing), 0}
end

local activeReserved = tonumber(redis.call('GET', totalKey) or '0') or 0
local fractionReserve = math.floor(pointsLimit * safetyReserveFraction)
local emergencyReserve = math.max(fractionReserve, minEmergencyReservePoints)
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

redis.call('HSET', resKey, jobId, tostring(estimated))
redis.call('INCRBY', totalKey, estimated)
redis.call('ZADD', leaseZ, leaseExpiry, jobId)
redis.call('SET', jobWindowKey, windowId)

return {1, 'OK', estimated, emergencyReserve, available}
`.trim();

/**
 * KEYS (release):
 *  1 wcl:{windowId}:reserved:total
 *  2 wcl:{windowId}:res
 *  3 wcl:lease
 *  4 slot:owners
 *  5 slot:lease
 *  6 slot:count
 *  7 job:{id}:window
 *
 * ARGV: 1 = ingestionJobId
 *
 * Releases estimated hold only — never subtracts measured provider spend from
 * the live WCL snapshot.
 */
export const REFRESH_ADMISSION_RELEASE_LUA = `
local totalKey = KEYS[1]
local resKey = KEYS[2]
local leaseZ = KEYS[3]
local slotOwners = KEYS[4]
local slotLease = KEYS[5]
local slotCountKey = KEYS[6]
local jobWindowKey = KEYS[7]
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

redis.call('DEL', jobWindowKey)

return {1, 'RELEASED', releasedPoints, hadSlot}
`.trim();

/**
 * KEYS (renew):
 *  1 wcl:lease
 *  2 slot:owners
 *  3 slot:lease
 *  4 wcl:{windowId}:res (optional — may be empty key when non-WCL)
 *
 * ARGV: 1=jobId, 2=leaseExpiryMs, 3=nowMs
 *
 * Renews only when this job still owns the slot (and reservation when present).
 */
export const REFRESH_ADMISSION_RENEW_LUA = `
local leaseZ = KEYS[1]
local slotOwners = KEYS[2]
local slotLease = KEYS[3]
local resKey = KEYS[4]
local jobId = ARGV[1]
local leaseExpiry = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])

local hasSlot = redis.call('HEXISTS', slotOwners, jobId)
if hasSlot ~= 1 then
  return {0, 'SLOT_NOT_OWNED', 0}
end

redis.call('HSET', slotOwners, jobId, tostring(leaseExpiry))
redis.call('ZADD', slotLease, leaseExpiry, jobId)

local existing = redis.call('HGET', resKey, jobId)
if existing then
  redis.call('ZADD', leaseZ, leaseExpiry, jobId)
end

return {1, 'RENEWED', leaseExpiry, nowMs}
`.trim();

/**
 * KEYS (expire sweep batch):
 *  1 wcl:lease
 *  2 slot:lease
 *
 * ARGV: 1=nowMs, 2=limit
 * Returns up to N expired job ids from either lease zset (union via two ranges).
 */
export const REFRESH_ADMISSION_EXPIRED_OWNERS_LUA = `
local wclLease = KEYS[1]
local slotLease = KEYS[2]
local nowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
if limit == nil or limit < 1 then limit = 50 end

local fromWcl = redis.call('ZRANGEBYSCORE', wclLease, '-inf', nowMs, 'LIMIT', 0, limit)
local fromSlot = redis.call('ZRANGEBYSCORE', slotLease, '-inf', nowMs, 'LIMIT', 0, limit)
local seen = {}
local out = {}
for _, id in ipairs(fromWcl) do
  if not seen[id] then
    seen[id] = true
    table.insert(out, id)
  end
end
for _, id in ipairs(fromSlot) do
  if not seen[id] then
    seen[id] = true
    table.insert(out, id)
  end
end
return out
`.trim();
