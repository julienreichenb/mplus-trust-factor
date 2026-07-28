import {
  SURVIVAL_STANDALONE_V1_1_CONFIG,
  type SurvivalStandaloneV1_1Config,
} from "./survival-v1_1-config.js";
import type {
  ExplicitHealthSnapshot,
  HealthSchemaVariant,
  HealthTimeline,
  HealthTimelinePoint,
  MaxHpResolution,
  SurvivalV1_1MaxHpConfidence,
} from "./survival-v1_1-types.js";

function asFinitePositive(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function asFiniteNonNeg(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return null;
}

/** Walk a JSON value and record paths that match health-related field names. */
export function discoverHealthSchemaVariants(
  root: unknown,
  sourceLabel: string,
  dataType: string,
  config: SurvivalStandaloneV1_1Config = SURVIVAL_STANDALONE_V1_1_CONFIG,
): HealthSchemaVariant[] {
  const candidates = new Set<string>(config.healthFieldCandidates);
  const counts = new Map<string, HealthSchemaVariant>();

  const visit = (node: unknown, path: string, depth: number): void => {
    if (node == null || depth > 12) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < Math.min(node.length, 50); i += 1) {
        visit(node[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (candidates.has(key) && value !== undefined && value !== null) {
        const mapKey = `${dataType}|${normalizePath(childPath)}|${typeof value}`;
        const existing = counts.get(mapKey);
        if (existing) {
          existing.occurrenceCount += 1;
        } else {
          counts.set(mapKey, {
            sourceLabel,
            dataType,
            path: normalizePath(childPath),
            sampleValueType: Array.isArray(value) ? "array" : typeof value,
            sampleValue: summarizeSample(value),
            occurrenceCount: 1,
          });
        }
      }
      if (typeof value === "object" && value !== null) {
        visit(value, childPath, depth + 1);
      }
    }
  };

  visit(root, "", 0);
  return [...counts.values()].sort((a, b) => b.occurrenceCount - a.occurrenceCount);
}

function normalizePath(path: string): string {
  return path.replace(/\[\d+]/g, "[]");
}

function summarizeSample(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return { arrayLength: value.length };
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).slice(0, 20);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = obj[k];
    out[k] = typeof v === "object" && v !== null ? `[${Array.isArray(v) ? "array" : "object"}]` : v;
  }
  return out;
}

interface ResourcePair {
  currentHp: number | null;
  maxHp: number | null;
  absorb: number | null;
  path: string;
}

/** Extract explicit current/max HP pairs from a single event object. */
export function extractResourcePairsFromEvent(
  event: Record<string, unknown>,
): ResourcePair[] {
  const pairs: ResourcePair[] = [];

  const pushFlat = (prefix: string, obj: Record<string, unknown> | null | undefined): void => {
    if (!obj) return;
    const maxHp =
      asFinitePositive(obj.maxHitPoints) ??
      asFinitePositive(obj.maxHealth) ??
      asFinitePositive(obj.maxHp);
    const currentHp =
      asFiniteNonNeg(obj.hitPoints) ??
      asFiniteNonNeg(obj.health) ??
      asFiniteNonNeg(obj.hp);
    const absorb =
      asFiniteNonNeg(obj.absorb) ??
      asFiniteNonNeg(obj.absorbed) ??
      null;
    if (maxHp != null || currentHp != null) {
      pairs.push({
        currentHp,
        maxHp,
        absorb,
        path: prefix,
      });
    }
  };

  pushFlat("event", event);
  pushFlat("event.targetResources", asRecord(event.targetResources));
  pushFlat("event.sourceResources", asRecord(event.sourceResources));
  pushFlat("event.target", asRecord(event.target));
  pushFlat("event.source", asRecord(event.source));

  // Nested resources array / object variants
  const resources = event.resources ?? event.classResources;
  if (Array.isArray(resources)) {
    for (let i = 0; i < resources.length; i += 1) {
      const r = asRecord(resources[i]);
      if (!r) continue;
      // Only treat as health when explicit HP fields exist.
      // Do NOT assume classResources type===0 is health (often mana in WoW).
      const maxHp =
        asFinitePositive(r.maxHitPoints) ??
        (r.hitPoints != null ? asFinitePositive(r.max) : null);
      const currentHp =
        asFiniteNonNeg(r.hitPoints) ??
        (r.maxHitPoints != null ? asFiniteNonNeg(r.current) ?? asFiniteNonNeg(r.amount) : null);
      if (maxHp == null && currentHp == null) continue;
      // Require an explicit HP field name — never mana-only classResources entries
      if (r.hitPoints == null && r.maxHitPoints == null && r.health == null && r.maxHealth == null) {
        continue;
      }
      pairs.push({
        currentHp,
        maxHp,
        absorb: asFiniteNonNeg(r.absorb) ?? null,
        path: `event.classResources[${i}]`,
      });
    }
  } else if (resources && typeof resources === "object") {
    pushFlat("event.resources", asRecord(resources));
  }

  return pairs;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function resolveActorId(
  event: Record<string, unknown>,
  flatKey: "sourceID" | "targetID",
  nestedKey: "source" | "target",
): number | null {
  const flat = event[flatKey];
  if (typeof flat === "number") return flat;
  const nested = asRecord(event[nestedKey]);
  if (nested && typeof nested.id === "number") return nested.id;
  return null;
}

export function collectExplicitHealthSnapshots(
  events: Array<Record<string, unknown>>,
  dataType: string,
  playerActorId: number,
): ExplicitHealthSnapshot[] {
  const out: ExplicitHealthSnapshot[] = [];
  for (const event of events) {
    const ts = typeof event.timestamp === "number" ? event.timestamp : null;
    if (ts == null) continue;
    const sourceID = resolveActorId(event, "sourceID", "source");
    const targetID = resolveActorId(event, "targetID", "target");
    const abilityGameID =
      typeof event.abilityGameID === "number"
        ? event.abilityGameID
        : typeof (event.ability as { guid?: number } | undefined)?.guid === "number"
          ? (event.ability as { guid: number }).guid
          : null;

    // WCL includeResources puts actor HP on the event root for the resource subject.
    // DamageTaken/Deaths: subject is usually the target (player). Healing: often target.
    const playerIsTarget = targetID === playerActorId;
    const playerIsSource = sourceID === playerActorId;
    if (!playerIsTarget && !playerIsSource) continue;

    const pairs = extractResourcePairsFromEvent(event);
    for (const pair of pairs) {
      const pathLower = pair.path.toLowerCase();
      if (pathLower.includes("sourceresources") && !playerIsSource) continue;
      if (pathLower.includes("targetresources") && !playerIsTarget) continue;
      // Root hitPoints/maxHitPoints on DamageTaken belong to the damaged actor (target).
      if (
        (pathLower === "event" || pathLower.startsWith("event.")) &&
        !pathLower.includes("source") &&
        !pathLower.includes("target") &&
        !pathLower.includes("resources")
      ) {
        if (dataType === "DamageTaken" || dataType === "Deaths" || dataType === "All") {
          if (!playerIsTarget) continue;
        } else if (dataType === "Healing") {
          if (!playerIsTarget) continue;
        } else if (!playerIsSource && !playerIsTarget) {
          continue;
        }
      }

      out.push({
        timestamp: ts,
        currentHp: pair.currentHp,
        maxHp: pair.maxHp,
        absorb: pair.absorb,
        path: `${dataType}.${pair.path}`,
        dataType,
        abilityGameID,
        sourceID,
        targetID,
        eventType: typeof event.type === "string" ? event.type : null,
        rawFragment: {
          hitPoints: pair.currentHp,
          maxHitPoints: pair.maxHp,
          absorb: pair.absorb,
          path: pair.path,
        },
      });
    }
  }
  return out;
}

export function collectHealthFromPlayerDetails(
  playerDetails: unknown,
  playerActorId: number,
  playerName?: string | null,
): ExplicitHealthSnapshot[] {
  const out: ExplicitHealthSnapshot[] = [];
  if (playerDetails == null) return out;

  const visit = (node: unknown, path: string): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) visit(node[i], `${path}[${i}]`);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const id =
      typeof obj.id === "number"
        ? obj.id
        : typeof obj.actorID === "number"
          ? obj.actorID
          : typeof obj.sourceID === "number"
            ? obj.sourceID
            : null;
    const name = typeof obj.name === "string" ? obj.name : null;
    const matchesPlayer =
      id === playerActorId ||
      (playerName != null && name != null && name.toLowerCase() === playerName.toLowerCase());

    const maxHp =
      asFinitePositive(obj.maxHitPoints) ??
      asFinitePositive(obj.maxHealth) ??
      asFinitePositive(obj.maxHp);
    const currentHp =
      asFiniteNonNeg(obj.hitPoints) ??
      asFiniteNonNeg(obj.health) ??
      asFiniteNonNeg(obj.hp);

    if (matchesPlayer && (maxHp != null || currentHp != null)) {
      out.push({
        timestamp: typeof obj.timestamp === "number" ? obj.timestamp : 0,
        currentHp,
        maxHp,
        absorb: asFiniteNonNeg(obj.absorb),
        path: `playerDetails.${path}`,
        dataType: "playerDetails",
        abilityGameID: null,
        sourceID: id,
        targetID: id,
        eventType: "playerDetails",
        rawFragment: { maxHitPoints: maxHp, hitPoints: currentHp },
      });
    }

    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "object" && v !== null) visit(v, path ? `${path}.${k}` : k);
    }
  };

  visit(playerDetails, "");
  return out;
}

/**
 * Resolve fight max HP from explicit evidence only.
 * Uses modal stable value; flags temporary max-HP outliers.
 */
export function resolveMaxHpFromSnapshots(
  input: {
    runId: string;
    reportCode: string;
    fightId: number;
    dungeonSlug: string;
    snapshots: ExplicitHealthSnapshot[];
  },
): MaxHpResolution {
  const values = input.snapshots
    .map((s) => s.maxHp)
    .filter((v): v is number => v != null && v > 0);

  if (values.length === 0) {
    return {
      runId: input.runId,
      reportCode: input.reportCode,
      fightId: input.fightId,
      dungeonSlug: input.dungeonSlug,
      maxHp: null,
      maxHpSource: null,
      maxHpConfidence: "NONE",
      sourcePayloadPath: null,
      corroboratingEventCount: 0,
      allObservedMaxHpValues: [],
      modalStableValue: null,
      temporaryMaxHpValues: [],
      conflictingValues: [],
      resolutionFailureReason: "no_explicit_max_hp_in_resource_snapshots_or_player_details",
    };
  }

  const freq = new Map<number, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const modal = sorted[0]![0];
  const modalCount = sorted[0]![1];

  // Temporary max HP: values that differ from modal by >5% and appear less often
  const temporary: number[] = [];
  const conflicting: number[] = [];
  for (const [value, count] of sorted.slice(1)) {
    const rel = Math.abs(value - modal) / modal;
    if (rel > 0.05) {
      if (count / modalCount < 0.25) temporary.push(value);
      else conflicting.push(value);
    } else {
      // near-modal noise — still track as conflict if not identical
      if (value !== modal) conflicting.push(value);
    }
  }

  const modalSnapshots = input.snapshots.filter((s) => s.maxHp === modal);
  const sourcePath = modalSnapshots[0]?.path ?? null;
  const sourceLabel = modalSnapshots[0]?.dataType ?? "unknown";

  let confidence: SurvivalV1_1MaxHpConfidence = "LOW";
  if (modalCount >= 10 && conflicting.length === 0) confidence = "HIGH";
  else if (modalCount >= 3) confidence = "MEDIUM";

  return {
    runId: input.runId,
    reportCode: input.reportCode,
    fightId: input.fightId,
    dungeonSlug: input.dungeonSlug,
    maxHp: modal,
    maxHpSource: sourceLabel,
    maxHpConfidence: confidence,
    sourcePayloadPath: sourcePath,
    corroboratingEventCount: modalCount,
    allObservedMaxHpValues: [...new Set(values)].sort((a, b) => a - b),
    modalStableValue: modal,
    temporaryMaxHpValues: temporary,
    conflictingValues: conflicting,
    resolutionFailureReason: null,
  };
}

export interface TimelineBuildInput {
  runId: string;
  reportCode: string;
  fightId: number;
  maxHp: number;
  snapshots: ExplicitHealthSnapshot[];
  damageEvents: Array<{
    timestamp: number;
    amount: number;
    absorbed?: number | null;
    abilityGameID?: number | null;
  }>;
  healEvents: Array<{
    timestamp: number;
    amount: number;
    abilityGameID?: number | null;
  }>;
  deathTimestamps: number[];
  fightStart: number;
  fightEnd: number;
  eventPagesComplete: boolean;
}

/**
 * Prefer observed snapshots. Reconstruct only forward from an explicit prior
 * when intervening damage/heal streams are complete and max HP is stable.
 */
export function buildHealthTimeline(input: TimelineBuildInput): HealthTimeline {
  const incompletenessReasons: string[] = [];
  if (!input.eventPagesComplete) {
    incompletenessReasons.push("incomplete_event_pagination");
  }

  const observed = input.snapshots
    .filter((s) => s.currentHp != null && s.maxHp != null)
    .map(
      (s): HealthTimelinePoint => ({
        timestamp: s.timestamp,
        currentHp: s.currentHp!,
        maxHp: s.maxHp!,
        hpPercent: s.maxHp! > 0 ? s.currentHp! / s.maxHp! : 0,
        absorbed: s.absorb,
        triggeringEvent: s.eventType ?? s.dataType,
        sourceAbility: s.abilityGameID,
        confidence: "OBSERVED",
        directlyObserved: true,
      }),
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  const points: HealthTimelinePoint[] = [...observed];

  // Reconstruct between observed anchors when pages are complete and maxHp matches modal.
  if (input.eventPagesComplete && observed.length > 0) {
    const deltas: Array<{ timestamp: number; delta: number; ability: number | null; kind: string }> =
      [];
    for (const d of input.damageEvents) {
      deltas.push({
        timestamp: d.timestamp,
        delta: -Math.max(0, d.amount),
        ability: d.abilityGameID ?? null,
        kind: "damage",
      });
    }
    for (const h of input.healEvents) {
      deltas.push({
        timestamp: h.timestamp,
        delta: Math.max(0, h.amount),
        ability: h.abilityGameID ?? null,
        kind: "heal",
      });
    }
    deltas.sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < observed.length; i += 1) {
      const anchor = observed[i]!;
      if (Math.abs(anchor.maxHp - input.maxHp) / input.maxHp > 0.05) {
        incompletenessReasons.push("temporary_max_hp_change_blocks_reconstruction");
        continue;
      }
      const nextTs = observed[i + 1]?.timestamp ?? input.fightEnd;
      let hp = anchor.currentHp;
      for (const d of deltas) {
        if (d.timestamp <= anchor.timestamp) continue;
        if (d.timestamp >= nextTs) break;
        // Skip reconstruction across death
        if (input.deathTimestamps.some((t) => t > anchor.timestamp && t < d.timestamp)) {
          incompletenessReasons.push("resurrection_or_death_gap");
          break;
        }
        hp = Math.min(input.maxHp, Math.max(0, hp + d.delta));
        points.push({
          timestamp: d.timestamp,
          currentHp: hp,
          maxHp: input.maxHp,
          hpPercent: hp / input.maxHp,
          absorbed: null,
          triggeringEvent: d.kind,
          sourceAbility: d.ability,
          confidence: "RECONSTRUCTED",
          directlyObserved: false,
        });
      }
    }
  } else if (observed.length === 0) {
    incompletenessReasons.push("no_observed_health_snapshots");
  }

  points.sort((a, b) => a.timestamp - b.timestamp || (a.directlyObserved ? -1 : 1));

  // Deduplicate exact timestamp preferring observed
  const dedup = new Map<number, HealthTimelinePoint>();
  for (const p of points) {
    const prev = dedup.get(p.timestamp);
    if (!prev || (p.directlyObserved && !prev.directlyObserved)) {
      dedup.set(p.timestamp, p);
    }
  }
  const finalPoints = [...dedup.values()].sort((a, b) => a.timestamp - b.timestamp);

  const complete =
    incompletenessReasons.length === 0 &&
    finalPoints.some((p) => p.directlyObserved) &&
    input.eventPagesComplete;

  return {
    runId: input.runId,
    reportCode: input.reportCode,
    fightId: input.fightId,
    complete,
    incompletenessReasons: [...new Set(incompletenessReasons)],
    points: finalPoints,
    observedSnapshotCount: observed.length,
    reconstructedPointCount: finalPoints.filter((p) => !p.directlyObserved).length,
  };
}

export function hpAtTimeline(
  timeline: HealthTimelinePoint[],
  timestamp: number,
): { currentHp: number; maxHp: number } | null {
  let current: HealthTimelinePoint | null = null;
  for (const p of timeline) {
    if (p.timestamp > timestamp) break;
    current = p;
  }
  if (!current) return null;
  return { currentHp: current.currentHp, maxHp: current.maxHp };
}
