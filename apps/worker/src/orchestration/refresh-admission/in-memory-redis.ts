/**
 * In-memory Redis subset that executes admission Lua via a JS port.
 * Used for unit/integration tests without a live Redis dependency.
 */

import {
  REFRESH_ADMISSION_EXPIRED_OWNERS_LUA,
  REFRESH_ADMISSION_RELEASE_LUA,
  REFRESH_ADMISSION_RENEW_LUA,
  REFRESH_ADMISSION_RESERVE_LUA,
} from "./lua-scripts.js";
import type { AdmissionRedis } from "./redis-ops.js";

type Hash = Map<string, string>;

export class InMemoryAdmissionRedis implements AdmissionRedis {
  private strings = new Map<string, string>();
  private hashes = new Map<string, Hash>();
  private zsets = new Map<string, Map<string, number>>();

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<"OK"> {
    this.strings.set(key, value);
    return "OK";
  }

  async exists(key: string): Promise<number> {
    return this.strings.has(key) || this.hashes.has(key) || this.zsets.has(key) ? 1 : 0;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hexists(key: string, field: string): Promise<number> {
    return this.hashes.get(key)?.has(field) ? 1 : 0;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash.entries());
  }

  async hmset(key: string, ...args: (string | number)[]): Promise<"OK"> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    for (let i = 0; i + 1 < args.length; i += 2) {
      hash.set(String(args[i]), String(args[i + 1]));
    }
    return "OK";
  }

  private hset(key: string, field: string, value: string): void {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    hash.set(field, value);
  }

  private hdel(key: string, field: string): number {
    const hash = this.hashes.get(key);
    if (!hash || !hash.has(field)) return 0;
    hash.delete(field);
    return 1;
  }

  private zadd(key: string, score: number, member: string): void {
    let z = this.zsets.get(key);
    if (!z) {
      z = new Map();
      this.zsets.set(key, z);
    }
    z.set(member, score);
  }

  private zrem(key: string, member: string): void {
    this.zsets.get(key)?.delete(member);
  }

  private zrangeByScore(key: string, max: number, limit: number): string[] {
    const z = this.zsets.get(key);
    if (!z) return [];
    return [...z.entries()]
      .filter(([, score]) => score <= max)
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([member]) => member);
  }

  async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys).map(String);

    if (script === REFRESH_ADMISSION_RESERVE_LUA || script.includes("INSUFFICIENT_RESERVED_CAPACITY")) {
      return this.evalReserve(keys, argv);
    }
    if (script === REFRESH_ADMISSION_RELEASE_LUA || script.includes("'RELEASED'")) {
      return this.evalRelease(keys, argv);
    }
    if (script === REFRESH_ADMISSION_RENEW_LUA || script.includes("'RENEWED'")) {
      return this.evalRenew(keys, argv);
    }
    if (script === REFRESH_ADMISSION_EXPIRED_OWNERS_LUA || script.includes("ZRANGEBYSCORE")) {
      return this.evalExpired(keys, argv);
    }
    throw new Error("Unknown Lua script in InMemoryAdmissionRedis");
  }

  private evalReserve(KEYS: string[], ARGV: string[]): unknown[] {
    const [
      schedKey,
      snapKey,
      totalKey,
      resKey,
      leaseZ,
      slotOwners,
      slotLease,
      slotCountKey,
      jobWindowKey,
    ] = KEYS;
    const jobId = ARGV[0]!;
    const estimated = Number(ARGV[1] ?? 0);
    const emergency = Number(ARGV[2] ?? 0);
    const globalLimit = Number(ARGV[3] ?? 1);
    const leaseExpiry = Number(ARGV[4] ?? 0);
    const expectedWindow = ARGV[5] ?? "";
    const nowMs = Number(ARGV[6] ?? 0);
    const maxAgeMs = Number(ARGV[7] ?? 0);
    const allowStates = ARGV[8] ?? "RUNNING";
    const safetyReserveFraction = Number(ARGV[9] ?? 0.1);
    const minEmergencyReservePoints = Number(ARGV[10] ?? 50);

    const state = this.strings.get(schedKey!) ?? "RUNNING";
    const allowed = allowStates.split(",").includes(state);
    if (!allowed) return [0, "SCHEDULING_PAUSED", state];

    if (estimated <= 0) {
      const hasSlot = this.hashes.get(slotOwners!)?.has(jobId) ?? false;
      if (hasSlot) {
        this.hset(slotOwners!, jobId, String(leaseExpiry));
        this.zadd(slotLease!, leaseExpiry, jobId);
        return [1, "IDEMPOTENT_EXISTING", 0, 1];
      }
      const currentSlots = Number(this.strings.get(slotCountKey!) ?? 0);
      if (currentSlots >= globalLimit) return [0, "INSUFFICIENT_GLOBAL_SLOTS", currentSlots];
      this.hset(slotOwners!, jobId, String(leaseExpiry));
      this.zadd(slotLease!, leaseExpiry, jobId);
      this.strings.set(slotCountKey!, String(currentSlots + 1));
      return [1, "OK", 0, 0, 0];
    }

    const snap = this.hashes.get(snapKey!);
    const pointsRemaining = Number(snap?.get("pointsRemaining"));
    const pointsLimit = Number(snap?.get("pointsLimit"));
    const fetchedAt = Number(snap?.get("fetchedAt"));
    const windowId = snap?.get("windowId");
    if (!Number.isFinite(pointsRemaining) || !Number.isFinite(pointsLimit) || !Number.isFinite(fetchedAt)) {
      return [0, "SNAPSHOT_MISSING", ""];
    }
    if (nowMs - fetchedAt > maxAgeMs) return [0, "SNAPSHOT_STALE", ""];
    if (!windowId || windowId !== expectedWindow) return [0, "WINDOW_ID_MISSING", String(windowId)];
    if (!(pointsLimit > 0)) return [0, "POINTS_LIMIT_INVALID", ""];

    const existing = this.hashes.get(resKey!)?.get(jobId);
    if (existing != null) {
      const heldSlot = this.hashes.get(slotOwners!)?.has(jobId) ?? false;
      if (heldSlot) {
        this.hset(slotOwners!, jobId, String(leaseExpiry));
        this.zadd(slotLease!, leaseExpiry, jobId);
        this.zadd(leaseZ!, leaseExpiry, jobId);
        this.strings.set(jobWindowKey!, windowId);
        return [1, "IDEMPOTENT_EXISTING", Number(existing), 1];
      }
      return [0, "INCONSISTENT_RESERVATION_WITHOUT_SLOT", Number(existing), 0];
    }

    const activeReserved = Number(this.strings.get(totalKey!) ?? 0);
    const emergencyReserve = Math.max(
      Math.floor(pointsLimit * safetyReserveFraction),
      minEmergencyReservePoints,
    );
    const available =
      emergency === 1
        ? Math.max(0, pointsRemaining - activeReserved)
        : Math.max(0, pointsRemaining - emergencyReserve - activeReserved);
    if (estimated > 0 && available < estimated) {
      return [0, "INSUFFICIENT_RESERVED_CAPACITY", available];
    }

    const currentSlots = Number(this.strings.get(slotCountKey!) ?? 0);
    const hasSlot = this.hashes.get(slotOwners!)?.has(jobId) ?? false;
    if (!hasSlot) {
      if (currentSlots >= globalLimit) return [0, "INSUFFICIENT_GLOBAL_SLOTS", currentSlots];
      this.hset(slotOwners!, jobId, String(leaseExpiry));
      this.zadd(slotLease!, leaseExpiry, jobId);
      this.strings.set(slotCountKey!, String(currentSlots + 1));
    }

    this.hset(resKey!, jobId, String(estimated));
    this.strings.set(totalKey!, String(activeReserved + estimated));
    this.zadd(leaseZ!, leaseExpiry, jobId);
    this.strings.set(jobWindowKey!, windowId);
    return [1, "OK", estimated, emergencyReserve, available];
  }

  private evalRelease(KEYS: string[], ARGV: string[]): unknown[] {
    const [totalKey, resKey, leaseZ, slotOwners, slotLease, slotCountKey, jobWindowKey] = KEYS;
    const jobId = ARGV[0]!;
    const existing = this.hashes.get(resKey!)?.get(jobId);
    let releasedPoints = 0;
    if (existing != null) {
      releasedPoints = Number(existing) || 0;
      this.hdel(resKey!, jobId);
      if (releasedPoints > 0) {
        const total = Number(this.strings.get(totalKey!) ?? 0);
        this.strings.set(totalKey!, String(total - releasedPoints));
      }
      this.zrem(leaseZ!, jobId);
    }
    const hadSlot = this.hdel(slotOwners!, jobId);
    if (hadSlot === 1) {
      this.zrem(slotLease!, jobId);
      const count = Number(this.strings.get(slotCountKey!) ?? 0);
      if (count > 0) this.strings.set(slotCountKey!, String(count - 1));
    }
    this.strings.delete(jobWindowKey!);
    return [1, "RELEASED", releasedPoints, hadSlot];
  }

  private evalRenew(KEYS: string[], ARGV: string[]): unknown[] {
    const [leaseZ, slotOwners, slotLease, resKey] = KEYS;
    const jobId = ARGV[0]!;
    const leaseExpiry = Number(ARGV[1] ?? 0);
    const nowMs = Number(ARGV[2] ?? 0);
    const hasSlot = this.hashes.get(slotOwners!)?.has(jobId) ?? false;
    if (!hasSlot) return [0, "SLOT_NOT_OWNED", 0];
    this.hset(slotOwners!, jobId, String(leaseExpiry));
    this.zadd(slotLease!, leaseExpiry, jobId);
    if (this.hashes.get(resKey!)?.has(jobId)) {
      this.zadd(leaseZ!, leaseExpiry, jobId);
    }
    return [1, "RENEWED", leaseExpiry, nowMs];
  }

  private evalExpired(KEYS: string[], ARGV: string[]): string[] {
    const [wclLease, slotLease] = KEYS;
    const nowMs = Number(ARGV[0] ?? 0);
    const limit = Number(ARGV[1] ?? 50);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of [
      ...this.zrangeByScore(wclLease!, nowMs, limit),
      ...this.zrangeByScore(slotLease!, nowMs, limit),
    ]) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }
}
