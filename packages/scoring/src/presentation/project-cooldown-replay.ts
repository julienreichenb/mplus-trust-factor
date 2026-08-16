import {
  enrichRuleExternalMetadata,
  getAllRegisteredRules,
  normalizeRetailClassSlug,
  resolveAbilityRuleBySpellId,
  type AbilityRule,
} from "@mplus/abilities";
import type {
  RunCooldownCombatSegmentPublicDTO,
  RunCooldownEventPublicDTO,
  RunCooldownEventTargetPublicDTO,
  RunCooldownTimelinePublicDTO,
  RunDeathTimelineEventPublicDTO,
  RunTimelineEventPublicDTO,
} from "@mplus/contracts";

/**
 * Pathological-overflow guard only.
 * Local 400-digest sample (uncapped): P50=110, P95=249, P99=394, max=527.
 * 800 is ceil(observedMax * 1.5) so complete replay stays the normal path.
 */
const MAX_EVENTS = 800;

/** Hostile-cast inactivity above this split is a new pull. Local P95 gap=7.7s, P99=19.5s. */
export const HOSTILE_PULL_GAP_MS = 20_000;

export interface CooldownReplayHostileActor {
  id: number;
  name: string;
  type?: string | null;
  subType?: string | null;
  petOwner?: number | null;
}

export interface CooldownReplayDigestInput {
  reportCode: string;
  fightId: number;
  classSlug?: string | null;
  specSlug?: string | null;
  participantActorId?: number | null;
  /** WCL fight-clock start used only to normalize absolute timestamps. */
  fightStartMs?: number | null;
  offensive: unknown;
  utility: unknown;
  survival: unknown;
  /** Deaths from every participant digest on the same PRIMARY raw run. */
  partyDeaths?: unknown;
  /** Names/classes from same-run participant digests when masterData is incomplete. */
  partyRoster?: ReadonlyArray<{
    participantActorId: number;
    name: string;
    classSlug?: string | null;
  }>;
  /** Same PRIMARY raw run `masterData.actors` only. */
  hostileActors?: ReadonlyArray<CooldownReplayHostileActor> | unknown;
}

type InternalCooldown = RunCooldownEventPublicDTO & { identity: string | null };
type InternalDeath = RunDeathTimelineEventPublicDTO & {
  identity: string | null;
  deceasedId: number;
};
type InternalEvent = InternalCooldown | InternalDeath;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function collectPairedFightStart(rows: unknown[]): number[] {
  const starts: number[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    const offset = finiteNumber(row.fightOffsetMs);
    const absolute = finiteNumber(row.timestampMs) ?? finiteNumber(row.rawTimestampMs);
    if (offset == null || absolute == null) continue;
    starts.push(absolute - offset);
  }
  return starts;
}

function resolveFightStartMs(
  input: CooldownReplayDigestInput,
  offensive: Record<string, unknown> | null,
  utility: Record<string, unknown> | null,
  survival: Record<string, unknown> | null,
): number | null {
  const explicit = finiteNumber(input.fightStartMs);
  if (explicit != null) return explicit;
  const paired = collectPairedFightStart([
    ...asArray(offensive?.offensiveActivations),
    ...asArray(utility?.actions),
    ...asArray(survival?.personalDefensiveActivations),
    ...asArray(survival?.recoveryActivations),
  ]);
  if (paired.length === 0) return null;
  const first = paired[0]!;
  return paired.every((value) => value === first) ? first : null;
}

function eventIdentity(row: Record<string, unknown>): string | null {
  for (const key of ["activationId", "canonicalActivationId", "canonicalActionId", "deathEventId"] as const) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * Relative fight offset with explicit semantics only:
 * A) fightOffsetMs when persisted as offset from selected fight start
 * B) absolute timestampMs / rawTimestampMs minus exact fightStartMs
 * C) otherwise omit (never infer from numeric magnitude)
 */
function relativeOffset(
  row: Record<string, unknown>,
  fightStartMs: number | null,
): number | null {
  const offset = finiteNumber(row.fightOffsetMs);
  if (offset != null && offset >= 0) return offset;
  const absolute = finiteNumber(row.timestampMs) ?? finiteNumber(row.rawTimestampMs);
  if (absolute == null || fightStartMs == null) return null;
  const relative = absolute - fightStartMs;
  return relative >= 0 ? relative : null;
}

function isInternalCatalogKey(value: string): boolean {
  return /^[a-z0-9_-]+(?:\.[a-z0-9_-]+){2,}$/i.test(value.trim());
}

function firstPositiveSpellId(...values: unknown[]): number | null {
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const parsed = finiteNumber(item);
        if (parsed != null && parsed > 0) return parsed;
      }
      continue;
    }
    const parsed = finiteNumber(value);
    if (parsed != null && parsed > 0) return parsed;
  }
  return null;
}

function resolveRuleByCanonicalKey(canonicalKey: string | null): AbilityRule | null {
  if (!canonicalKey) return null;
  const matches = getAllRegisteredRules().filter((rule) => rule.canonicalKey === canonicalKey);
  return matches.length === 1 ? matches[0]! : null;
}

function resolveCatalogRule(input: {
  spellId: number | null;
  canonicalKey: string | null;
  classSlug?: string | null;
  specSlug?: string | null;
}): AbilityRule | null {
  const spellId = input.spellId;
  if (spellId != null) {
    const strict = resolveAbilityRuleBySpellId({
      spellId,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
    });
    if (strict.status === "matched") return strict.rule;
    const relaxed = resolveAbilityRuleBySpellId({
      spellId,
      classSlug: input.classSlug,
    });
    if (relaxed.status === "matched") return relaxed.rule;
    if (relaxed.status === "ambiguous" && input.canonicalKey) {
      return relaxed.rules.find((rule) => rule.canonicalKey === input.canonicalKey) ?? null;
    }
  }
  return resolveRuleByCanonicalKey(input.canonicalKey);
}

function persistedDisplayName(value: string | null): string | null {
  if (!value || isInternalCatalogKey(value)) return null;
  return value;
}

function resolveAbility(input: {
  spellId: number | null;
  canonicalKey?: string | null;
  persistedName?: string | null;
  classSlug?: string | null;
  specSlug?: string | null;
}): {
  abilityId: number | null;
  abilityName: string | null;
  iconName: string | null;
  iconUrl: string | null;
} {
  const rule = resolveCatalogRule({
    spellId: input.spellId,
    canonicalKey: input.canonicalKey ?? null,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });
  const abilityId = input.spellId ?? (rule?.spellIds[0] != null && rule.spellIds[0] > 0 ? rule.spellIds[0] : null);
  if (rule) {
    const meta = enrichRuleExternalMetadata(rule);
    return {
      abilityId,
      abilityName: rule.name,
      iconName: meta.iconName,
      iconUrl: meta.iconUrl,
    };
  }
  return {
    abilityId,
    abilityName: persistedDisplayName(input.persistedName ?? null),
    iconName: null,
    iconUrl: null,
  };
}

export function clusterHostilePullSegments(
  offsetsMs: readonly number[],
  durationMs: number,
): RunCooldownCombatSegmentPublicDTO[] {
  const stamps = [...new Set(offsetsMs.filter((value) => value >= 0 && value <= durationMs))].sort(
    (a, b) => a - b,
  );
  if (stamps.length === 0) return [];
  const windows: Array<{ startMs: number; endMs: number }> = [
    { startMs: stamps[0]!, endMs: stamps[0]! },
  ];
  for (let i = 1; i < stamps.length; i += 1) {
    const stamp = stamps[i]!;
    const current = windows[windows.length - 1]!;
    if (stamp - current.endMs > HOSTILE_PULL_GAP_MS) {
      windows.push({ startMs: stamp, endMs: stamp });
    } else {
      current.endMs = stamp;
    }
  }
  return windows.map((window, index) => ({
    index: index + 1,
    startMs: window.startMs,
    endMs: window.endMs,
    bossName: null,
    bossPortraitUrl: null,
  }));
}

export function parseWclMasterDataActors(value: unknown): CooldownReplayHostileActor[] {
  if (!Array.isArray(value)) return [];
  const actors: CooldownReplayHostileActor[] = [];
  for (const raw of value) {
    const row = asRecord(raw);
    if (!row) continue;
    const id = finiteNumber(row.id);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (id == null || name === "") continue;
    actors.push({
      id,
      name,
      type: typeof row.type === "string" ? row.type : null,
      subType: typeof row.subType === "string" ? row.subType : null,
      petOwner: finiteNumber(row.petOwner),
    });
  }
  return actors;
}

/** Exact persisted WCL `subType` classification; Environment is not a dungeon boss. */
export function isPersistedWclBossActor(actor: CooldownReplayHostileActor): boolean {
  return actor.id > 0 && actor.name !== "Environment" && actor.subType === "Boss";
}

function classSlugFromWclActor(actor: CooldownReplayHostileActor): string | null {
  if (actor.type != null && actor.type !== "Player") return null;
  const raw = actor.subType?.trim() ?? "";
  if (!raw || raw.toLowerCase() === "unknown") return null;
  const hyphenated = raw.replace(/([a-z])([A-Z])/g, "$1-$2");
  return normalizeRetailClassSlug(hyphenated);
}

function extractDeathsFromSurvival(survival: Record<string, unknown> | null): unknown[] {
  if (!survival) return [];
  if (Array.isArray(survival.deaths)) return survival.deaths;
  const timeline = asRecord(survival.timeline);
  if (timeline && Array.isArray(timeline.deaths)) return timeline.deaths;
  return [];
}

function mergeDeathRows(survivalDeaths: unknown[], partyDeaths: unknown[] | undefined): unknown[] {
  const merged = [...survivalDeaths, ...(partyDeaths ?? [])];
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const raw of merged) {
    const row = asRecord(raw);
    const identity = row && typeof row.deathEventId === "string" ? row.deathEventId : null;
    if (identity) {
      if (seen.has(identity)) continue;
      seen.add(identity);
    }
    out.push(raw);
  }
  return out;
}

function deceasedActorId(row: Record<string, unknown>): number | null {
  const id =
    finiteNumber(row.participantActorId) ??
    finiteNumber(row.targetPlayerActorId);
  return id != null && id > 0 ? id : null;
}

function isFriendlyPartyPlayerActor(actor: CooldownReplayHostileActor): boolean {
  if (actor.id <= 0 || actor.name === "Environment") return false;
  if (actor.petOwner != null && actor.petOwner > 0) return false;
  return actor.type === "Player";
}

function compareReplayEvents(a: InternalEvent, b: InternalEvent): number {
  if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
  const aKind = a.kind === "DEATH" ? 1 : 0;
  const bKind = b.kind === "DEATH" ? 1 : 0;
  if (aKind !== bKind) return aKind - bKind;
  const aId = a.identity ?? "";
  const bId = b.identity ?? "";
  if (aId !== bId) return aId.localeCompare(bId);
  if (a.kind === "DEATH" && b.kind === "DEATH") return a.playerName.localeCompare(b.playerName);
  if (a.kind === "COOLDOWN" && b.kind === "COOLDOWN") {
    return (
      a.dimension.localeCompare(b.dimension) ||
      (a.abilityId ?? 0) - (b.abilityId ?? 0)
    );
  }
  return 0;
}

export function projectCooldownEventTarget(
  targetActorId: number | null,
  participantActorId: number | null,
  actorsById: ReadonlyMap<number, CooldownReplayHostileActor>,
): RunCooldownEventTargetPublicDTO | null {
  if (targetActorId == null || targetActorId <= 0) return null;
  if (participantActorId != null && targetActorId === participantActorId) {
    return {
      kind: "SELF",
      name: null,
      classSlug: null,
      iconName: null,
      portraitUrl: null,
    };
  }
  const actor = actorsById.get(targetActorId);
  if (!actor) {
    return {
      kind: "UNKNOWN",
      name: null,
      classSlug: null,
      iconName: null,
      portraitUrl: null,
    };
  }
  const name = actor.name.trim() || null;
  if (actor.type === "Player") {
    return {
      kind: "FRIENDLY_PLAYER",
      name,
      classSlug: classSlugFromWclActor(actor),
      iconName: null,
      portraitUrl: null,
    };
  }
  if (actor.type === "Pet" || actor.type === "Guardian") {
    return {
      kind: "FRIENDLY_OTHER",
      name,
      classSlug: null,
      iconName: null,
      portraitUrl: null,
    };
  }
  if (actor.type === "NPC" || actor.type === "Enemy" || actor.subType === "Boss" || actor.subType === "NPC") {
    return {
      kind: "HOSTILE",
      name,
      classSlug: null,
      iconName: null,
      portraitUrl: null,
    };
  }
  return {
    kind: "UNKNOWN",
    name,
    classSlug: null,
    iconName: null,
    portraitUrl: null,
  };
}

function persistedTargetActorId(row: Record<string, unknown>): number | null {
  const id = finiteNumber(row.targetActorId);
  return id != null && id > 0 ? id : null;
}

function annotateSegmentBosses(
  segments: RunCooldownCombatSegmentPublicDTO[],
  hostileCastEvents: unknown[],
  actors: CooldownReplayHostileActor[],
  fightStartMs: number | null,
): RunCooldownCombatSegmentPublicDTO[] {
  const bossesById = new Map(
    actors.filter(isPersistedWclBossActor).map((actor) => [actor.id, actor] as const),
  );
  return segments.map((segment) => {
    const involved = new Set<number>();
    for (const raw of hostileCastEvents) {
      const row = asRecord(raw);
      if (!row) continue;
      const offset = relativeOffset(row, fightStartMs);
      if (offset == null || offset < segment.startMs || offset > segment.endMs) continue;
      const source = finiteNumber(row.sourceActorId);
      const target = finiteNumber(row.targetActorId);
      if (source != null) involved.add(source);
      if (target != null) involved.add(target);
    }
    const names = [...new Set(
      [...involved]
        .map((id) => bossesById.get(id)?.name)
        .filter((name): name is string => Boolean(name)),
    )].sort((a, b) => a.localeCompare(b));
    return {
      ...segment,
      bossName: names.length === 0 ? null : names.join(" & "),
      bossPortraitUrl: null,
    };
  });
}

function assignSegmentIndex(
  timestampMs: number,
  segments: RunCooldownCombatSegmentPublicDTO[],
): number | null {
  const hit = segments.find((segment) => timestampMs >= segment.startMs && timestampMs <= segment.endMs);
  return hit?.index ?? null;
}

function mapUtilityType(category: string | null): string | null {
  switch (category) {
    case "INTERRUPT":
      return "interrupt";
    case "CROWD_CONTROL":
      return "crowd control";
    case "STOP":
      return "stop";
    case "OFFENSIVE_DISPEL":
    case "DEFENSIVE_DISPEL":
      return "dispel";
    case "COMBAT_RES":
      return "combat res";
    case "EXTERNAL_SUPPORT":
    case "OTHER_UTILITY":
      return "utility";
    default:
      return null;
  }
}

function mapSurvivalType(row: Record<string, unknown>): string | null {
  const kind = typeof row.activationKind === "string" ? row.activationKind : null;
  if (kind === "EXTERNAL_DEFENSIVE_RECEIVED") return null;
  const category = typeof row.defensiveCategory === "string" ? row.defensiveCategory : null;
  if (category === "IMMUNITY") return "immunity";
  if (category === "CONSUMABLE") return "consumable";
  if (kind === "RECOVERY" || category === "SELF_HEAL") return "recovery";
  if (kind === "PERSONAL_DEFENSIVE" || category === "DEFENSIVE_MAJOR" || category === "DEFENSIVE_MINOR") {
    return "defensive cooldown";
  }
  return null;
}

function unavailable(): RunCooldownTimelinePublicDTO {
  return {
    status: "UNAVAILABLE",
    durationMs: null,
    events: [],
    truncated: false,
    totalEventCount: 0,
    segments: [],
  };
}

export function projectCooldownReplayFromDigest(
  input: CooldownReplayDigestInput | null | undefined,
): RunCooldownTimelinePublicDTO {
  if (!input) return unavailable();

  const offensive = asRecord(input.offensive);
  const utility = asRecord(input.utility);
  const survival = asRecord(input.survival);
  const durationMs = finiteNumber(survival?.fightDurationMs);
  if (durationMs == null) return unavailable();

  const fightStartMs = resolveFightStartMs(input, offensive, utility, survival);
  const actors = parseWclMasterDataActors(input.hostileActors);
  const actorsById = new Map(actors.map((actor) => [actor.id, actor] as const));
  const rosterById = new Map<number, { name: string; classSlug: string | null }>();
  for (const entry of input.partyRoster ?? []) {
    const id = finiteNumber(entry.participantActorId);
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (id == null || id <= 0 || !name) continue;
    rosterById.set(id, {
      name,
      classSlug: typeof entry.classSlug === "string" ? entry.classSlug : null,
    });
  }
  const participantActorId = finiteNumber(input.participantActorId);
  const events: InternalEvent[] = [];

  for (const raw of asArray(offensive?.offensiveActivations)) {
    const row = asRecord(raw);
    if (!row) continue;
    const timestampMs = relativeOffset(row, fightStartMs);
    if (timestampMs == null) continue;
    const ability = resolveAbility({
      spellId: firstPositiveSpellId(row.primarySpellId, row.observedSpellIds, row.contributingSpellIds),
      canonicalKey: typeof row.canonicalKey === "string" ? row.canonicalKey : null,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
    });
    events.push({
      kind: "COOLDOWN",
      timestampMs,
      dimension: "PERFORMANCE",
      type: "offensive cooldown",
      ...ability,
      identity: eventIdentity(row),
      target: projectCooldownEventTarget(persistedTargetActorId(row), participantActorId, actorsById),
    });
  }

  for (const raw of asArray(utility?.actions)) {
    const row = asRecord(raw);
    if (!row) continue;
    const type = mapUtilityType(typeof row.utilityCategory === "string" ? row.utilityCategory : null);
    if (!type) continue;
    const timestampMs = relativeOffset(row, fightStartMs);
    if (timestampMs == null) continue;
    const ability = resolveAbility({
      spellId: firstPositiveSpellId(row.primarySpellId),
      persistedName: typeof row.canonicalName === "string" ? row.canonicalName : null,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
    });
    events.push({
      kind: "COOLDOWN",
      timestampMs,
      dimension: "UTILITY",
      type,
      ...ability,
      identity: eventIdentity(row),
      target: projectCooldownEventTarget(persistedTargetActorId(row), participantActorId, actorsById),
    });
  }

  for (const raw of [
    ...asArray(survival?.personalDefensiveActivations),
    ...asArray(survival?.recoveryActivations),
  ]) {
    const row = asRecord(raw);
    if (!row) continue;
    const type = mapSurvivalType(row);
    if (!type) continue;
    const timestampMs = relativeOffset(row, fightStartMs);
    if (timestampMs == null) continue;
    const ability = resolveAbility({
      spellId: firstPositiveSpellId(row.primarySpellId),
      persistedName: typeof row.canonicalName === "string" ? row.canonicalName : null,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
    });
    events.push({
      kind: "COOLDOWN",
      timestampMs,
      dimension: "SURVIVAL",
      type,
      ...ability,
      identity: eventIdentity(row),
      target: projectCooldownEventTarget(persistedTargetActorId(row), participantActorId, actorsById),
    });
  }

  const deathRows = mergeDeathRows(extractDeathsFromSurvival(survival), asArray(input.partyDeaths));
  for (const raw of deathRows) {
    const row = asRecord(raw);
    if (!row) continue;
    const timestampMs = relativeOffset(row, fightStartMs);
    if (timestampMs == null) continue;
    const deceasedId = deceasedActorId(row);
    if (deceasedId == null) continue;
    const actor = actorsById.get(deceasedId);
    if (actor && !isFriendlyPartyPlayerActor(actor)) continue;
    const roster = rosterById.get(deceasedId);
    if (!actor && !roster) continue;
    const playerName =
      (actor && isFriendlyPartyPlayerActor(actor) ? actor.name.trim() : "") || roster?.name || "";
    if (!playerName) continue;
    const classSlug =
      (actor && isFriendlyPartyPlayerActor(actor) ? classSlugFromWclActor(actor) : null) ??
      roster?.classSlug ??
      null;
    const evidenceId = typeof row.evidenceEventId === "string" ? row.evidenceEventId.trim() : "";
    events.push({
      kind: "DEATH",
      timestampMs,
      playerName,
      classSlug,
      segmentIndex: null,
      identity: eventIdentity(row) ?? (evidenceId ? `${timestampMs}|${deceasedId}|${evidenceId}` : null),
      deceasedId,
    });
  }

  const inRange = events.filter((event) => {
    if (event.timestampMs < 0) return false;
    if (event.kind === "DEATH") return true;
    return event.timestampMs <= durationMs;
  });
  inRange.sort(compareReplayEvents);

  const hostileCastEvents = asArray(utility?.hostileCastEvents);
  const hostileOffsets = hostileCastEvents.flatMap((raw) => {
    const row = asRecord(raw);
    if (!row) return [];
    const offset = relativeOffset(row, fightStartMs);
    return offset == null ? [] : [offset];
  });
  const segments = annotateSegmentBosses(
    clusterHostilePullSegments(hostileOffsets, durationMs),
    hostileCastEvents,
    actors,
    fightStartMs,
  );

  const seenIdentity = new Set<string>();
  const seenCast = new Set<string>();
  const seenDeathStamp = new Set<string>();
  const deduped: RunTimelineEventPublicDTO[] = [];
  for (const event of inRange) {
    if (event.kind === "DEATH") {
      if (event.identity) {
        if (seenIdentity.has(event.identity)) continue;
        seenIdentity.add(event.identity);
      } else {
        const stamp = `${event.timestampMs}|${event.deceasedId}|death`;
        if (seenDeathStamp.has(stamp)) continue;
        seenDeathStamp.add(stamp);
      }
      deduped.push({
        kind: "DEATH",
        timestampMs: event.timestampMs,
        playerName: event.playerName,
        classSlug: event.classSlug,
        segmentIndex: assignSegmentIndex(event.timestampMs, segments),
      });
      continue;
    }
    if (event.identity) {
      if (seenIdentity.has(event.identity)) continue;
      seenIdentity.add(event.identity);
    } else if (event.abilityId != null) {
      const castKey = `${event.timestampMs}|${event.abilityId}`;
      if (seenCast.has(castKey)) continue;
      seenCast.add(castKey);
    }
    deduped.push({
      kind: "COOLDOWN",
      timestampMs: event.timestampMs,
      dimension: event.dimension,
      type: event.type,
      abilityId: event.abilityId,
      abilityName: event.abilityName,
      iconName: event.iconName ?? null,
      iconUrl: event.iconUrl,
      segmentIndex: assignSegmentIndex(event.timestampMs, segments),
      target: event.target ?? null,
    });
  }

  const truncated = deduped.length > MAX_EVENTS;
  return {
    status: deduped.length > 0 ? "AVAILABLE" : "EMPTY",
    durationMs,
    events: truncated ? deduped.slice(0, MAX_EVENTS) : deduped,
    truncated,
    totalEventCount: deduped.length,
    segments,
  };
}

export const COOLDOWN_REPLAY_MAX_EVENTS = MAX_EVENTS;
