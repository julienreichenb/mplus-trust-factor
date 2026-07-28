import type { AbilityCatalog, AbilityCategory, AbilityRule } from "@mplus/abilities";
import { rulesForSpell } from "@mplus/abilities";
import {
  CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
  ENCOUNTER_DUNGEON_MAP,
} from "../discovery/run-discovery.js";
import type { WclActorMap, WclRankingObservation } from "../types.js";
import type {
  SurvivalCandidateRejection,
  SurvivalDamageByAbility,
  SurvivalDamageBySource,
  SurvivalDeathFact,
  SurvivalEventDataType,
  SurvivalHealingFact,
  SurvivalMatchedAbilityUsage,
  SurvivalNormalizedDataset,
  SurvivalPreservedEvent,
  SurvivalProbeIdentity,
  SurvivalRawEventDataset,
  SurvivalRunCandidate,
} from "./survival-probe-types.js";

/**
 * WCL GraphQL Character.classID uses WCL's class index (not Blizzard class IDs).
 * Warlock=10 matches Wallidrixe / Demonology live fixtures.
 */
export const WCL_CLASS_ID_TO_SLUG: Record<number, string> = {
  1: "death-knight",
  2: "druid",
  3: "hunter",
  4: "mage",
  5: "monk",
  6: "paladin",
  7: "priest",
  8: "rogue",
  9: "shaman",
  10: "warlock",
  11: "warrior",
  12: "demon-hunter",
  13: "evoker",
};

const DEFENSIVE_CATEGORIES = new Set<AbilityCategory>([
  "DEFENSIVE_MAJOR",
  "DEFENSIVE_MINOR",
  "IMMUNITY",
]);

const SELF_HEAL_CONSUMABLE_CATEGORIES = new Set<AbilityCategory>(["SELF_HEAL", "CONSUMABLE"]);

const KNOWN_EVENT_FIELDS = new Set([
  "timestamp",
  "sourceID",
  "targetID",
  "abilityGameID",
  "amount",
  "absorbed",
  "overkill",
  "hitType",
  "ability",
  "source",
  "target",
]);

export function activeSeasonDungeonPool(allowed?: string[]): string[] {
  const pool = (allowed ?? CURRENT_MPLUS_ZONE_DUNGEON_SLUGS)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(pool)].filter((slug) => !slug.includes("icecrown"));
}

/** Match selectScoringRuns: highest key → highest score → latest. */
export function compareSurvivalCandidates(a: SurvivalRunCandidate, b: SurvivalRunCandidate): number {
  const keyA = a.keyLevel ?? -1;
  const keyB = b.keyLevel ?? -1;
  if (keyB !== keyA) return keyB - keyA;
  const scoreA = a.score ?? -1;
  const scoreB = b.score ?? -1;
  if (scoreB !== scoreA) return scoreB - scoreA;
  const timeA = a.completedAt ? Date.parse(a.completedAt) : (a.startTimeMs ?? 0);
  const timeB = b.completedAt ? Date.parse(b.completedAt) : (b.startTimeMs ?? 0);
  return timeB - timeA;
}

export function rankingsToSurvivalCandidates(
  rankings: WclRankingObservation[],
  allowedDungeonSlugs: string[] = CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
): Map<string, SurvivalRunCandidate[]> {
  const allowed = new Set(activeSeasonDungeonPool(allowedDungeonSlugs));
  const byDungeon = new Map<string, SurvivalRunCandidate[]>();

  for (const row of rankings) {
    const dungeonSlug = ENCOUNTER_DUNGEON_MAP[row.encounterId] ?? null;
    if (!dungeonSlug || !allowed.has(dungeonSlug)) continue;

    const candidate: SurvivalRunCandidate = {
      reportCode: row.reportCode,
      fightId: row.fightId,
      encounterId: row.encounterId,
      dungeonSlug,
      keyLevel: row.keyLevel,
      score: row.score,
      durationMs: row.durationMs,
      startTimeMs: row.startTimeMs,
      completedAt:
        row.reportStartTimeMs != null && row.startTimeMs != null
          ? new Date(row.reportStartTimeMs + row.startTimeMs).toISOString()
          : null,
      specSlug: row.specSlug,
      roleSlug: row.roleSlug,
      rank: 0,
    };
    const bucket = byDungeon.get(dungeonSlug) ?? [];
    bucket.push(candidate);
    byDungeon.set(dungeonSlug, bucket);
  }

  for (const [slug, bucket] of byDungeon) {
    const sorted = [...bucket].sort(compareSurvivalCandidates);
    byDungeon.set(
      slug,
      sorted.map((c, index) => ({ ...c, rank: index + 1 })),
    );
  }

  return byDungeon;
}

/** Aggregate zoneRankings rows (no report/fight) → dungeon score/spec hints. */
export function extractAggregateDungeonHints(rawZoneRankings: unknown): Map<
  string,
  { encounterId: number; score: number | null; specSlug: string | null; keyLevelHint: number | null }
> {
  const out = new Map<
    string,
    { encounterId: number; score: number | null; specSlug: string | null; keyLevelHint: number | null }
  >();
  if (!rawZoneRankings || typeof rawZoneRankings !== "object") return out;
  const rankings = (rawZoneRankings as { rankings?: unknown[] }).rankings;
  if (!Array.isArray(rankings)) return out;

  for (const row of rankings) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const encounter = r.encounter as { id?: unknown; name?: unknown } | undefined;
    const encounterId = asFiniteNumber(encounter?.id) ?? asFiniteNumber(r.encounterID);
    if (encounterId == null) continue;
    const dungeonSlug = ENCOUNTER_DUNGEON_MAP[encounterId];
    if (!dungeonSlug) continue;

    const allStars = r.allStars as Record<string, unknown> | undefined;
    const bestRank = r.bestRank as Record<string, unknown> | undefined;
    const score =
      asFiniteNumber(r.bestAmount) ??
      asFiniteNumber(allStars?.points) ??
      asFiniteNumber(bestRank?.score) ??
      asFiniteNumber(r.score);
    const specRaw = r.bestSpec ?? r.spec;
    const specSlug = typeof specRaw === "string" ? normalizeSpecSlug(specRaw) : null;

    out.set(dungeonSlug, {
      encounterId,
      score,
      specSlug,
      keyLevelHint: null,
    });
  }
  return out;
}

/**
 * Merge hydrated fight candidates with aggregate dungeon score/spec hints,
 * filtered to the active-season pool (never Icecrown).
 */
export function buildSurvivalCandidateQueuesFromHydrated(
  hydrated: Array<{
    reportCode: string;
    fightId: number;
    encounterId: number;
    dungeonSlug: string | null;
    keyLevel: number | null;
    score: number | null;
    durationMs: number | null;
    startTimeMs: number | null;
    completedAt: string | null;
    specSlug?: string | null;
    roleSlug?: string | null;
  }>,
  aggregateHints: Map<
    string,
    { encounterId: number; score: number | null; specSlug: string | null; keyLevelHint: number | null }
  >,
  allowedDungeonSlugs: string[] = CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
): Map<string, SurvivalRunCandidate[]> {
  const allowed = new Set(activeSeasonDungeonPool(allowedDungeonSlugs));
  const byDungeon = new Map<string, SurvivalRunCandidate[]>();

  for (const row of hydrated) {
    const dungeonSlug = row.dungeonSlug?.toLowerCase() ?? null;
    if (!dungeonSlug || !allowed.has(dungeonSlug)) continue;
    if (!row.fightId || row.fightId <= 0) continue;

    const hint = aggregateHints.get(dungeonSlug);
    const candidate: SurvivalRunCandidate = {
      reportCode: row.reportCode,
      fightId: row.fightId,
      encounterId: row.encounterId || hint?.encounterId || 0,
      dungeonSlug,
      keyLevel: row.keyLevel,
      score: row.score ?? hint?.score ?? null,
      durationMs: row.durationMs,
      startTimeMs: row.startTimeMs,
      completedAt: row.completedAt,
      specSlug: row.specSlug ?? hint?.specSlug ?? null,
      roleSlug: row.roleSlug ?? null,
      rank: 0,
    };
    const bucket = byDungeon.get(dungeonSlug) ?? [];
    bucket.push(candidate);
    byDungeon.set(dungeonSlug, bucket);
  }

  // Prefer dungeons with higher aggregate score first in inspection order.
  const dungeonOrder = [...byDungeon.keys()].sort((a, b) => {
    const scoreA = aggregateHints.get(a)?.score ?? -1;
    const scoreB = aggregateHints.get(b)?.score ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.localeCompare(b);
  });

  const ordered = new Map<string, SurvivalRunCandidate[]>();
  for (const slug of dungeonOrder) {
    const bucket = byDungeon.get(slug) ?? [];
    const sorted = [...bucket].sort(compareSurvivalCandidates);
    ordered.set(
      slug,
      sorted.map((c, index) => ({ ...c, rank: index + 1 })),
    );
  }
  return ordered;
}

/**
 * Flatten per-dungeon highest-first queues into inspection order.
 * Walks each active dungeon’s score-sorted candidates before moving on.
 */
export function flattenCandidateInspectionOrder(
  byDungeon: Map<string, SurvivalRunCandidate[]>,
  dungeonOrder: string[] = CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
): SurvivalRunCandidate[] {
  const ordered: SurvivalRunCandidate[] = [];
  const pool = activeSeasonDungeonPool(dungeonOrder);
  for (const slug of pool) {
    const bucket = byDungeon.get(slug) ?? [];
    ordered.push(...bucket);
  }
  return ordered;
}

export function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function preserveEventFields(row: Record<string, unknown>): SurvivalPreservedEvent {
  const ability = row.ability as Record<string, unknown> | undefined;
  const source = row.source as Record<string, unknown> | undefined;
  const target = row.target as Record<string, unknown> | undefined;

  const abilityGameID =
    asFiniteNumber(row.abilityGameID) ??
    (ability ? asFiniteNumber(ability.guid) ?? asFiniteNumber(ability.abilityGameID) : null);

  const sourceID = asFiniteNumber(row.sourceID) ?? (source ? asFiniteNumber(source.id) : null);
  const targetID = asFiniteNumber(row.targetID) ?? (target ? asFiniteNumber(target.id) : null);

  const additionalFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (KNOWN_EVENT_FIELDS.has(key)) continue;
    additionalFields[key] = value;
  }

  if (ability) {
    const abilityExtras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ability)) {
      if (k === "guid" || k === "abilityGameID") continue;
      abilityExtras[k] = v;
    }
    if (Object.keys(abilityExtras).length > 0) additionalFields.abilityExtras = abilityExtras;
  }
  if (source) {
    const sourceExtras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(source)) {
      if (k === "id") continue;
      sourceExtras[k] = v;
    }
    if (Object.keys(sourceExtras).length > 0) additionalFields.sourceExtras = sourceExtras;
  }
  if (target) {
    const targetExtras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(target)) {
      if (k === "id") continue;
      targetExtras[k] = v;
    }
    if (Object.keys(targetExtras).length > 0) additionalFields.targetExtras = targetExtras;
  }

  return {
    timestamp: asFiniteNumber(row.timestamp),
    sourceID,
    targetID,
    abilityGameID,
    amount: asFiniteNumber(row.amount),
    absorbed: asFiniteNumber(row.absorbed),
    overkill: asFiniteNumber(row.overkill),
    hitType: asFiniteNumber(row.hitType),
    additionalFields,
    raw: { ...row },
  };
}

function isTalentDependentOrUncertain(rule: AbilityRule): boolean {
  if (rule.availability === "TALENT" || rule.availability === "CHOICE_NODE") return true;
  if (rule.supportCertainty === "uncertain") return true;
  if (rule.provenance.certainty === "uncertain") return true;
  return false;
}

function auraType(row: Record<string, unknown>): string | null {
  const t = row.type;
  return typeof t === "string" ? t : null;
}

export function collectSpellIdsFromEvents(
  casts: Array<Record<string, unknown>>,
  buffs: Array<Record<string, unknown>>,
  healing: Array<Record<string, unknown>>,
  attributedSourceIds: Set<number>,
  playerActorId: number,
): number[] {
  const ids = new Set<number>();
  for (const row of casts) {
    const preserved = preserveEventFields(row);
    if (preserved.sourceID == null || !attributedSourceIds.has(preserved.sourceID)) continue;
    if (preserved.abilityGameID != null) ids.add(preserved.abilityGameID);
  }
  for (const row of buffs) {
    const preserved = preserveEventFields(row);
    if (
      (preserved.sourceID == null || !attributedSourceIds.has(preserved.sourceID)) &&
      preserved.targetID !== playerActorId
    ) {
      continue;
    }
    if (preserved.abilityGameID != null) ids.add(preserved.abilityGameID);
  }
  for (const row of healing) {
    const preserved = preserveEventFields(row);
    if (preserved.sourceID !== playerActorId) continue;
    if (preserved.abilityGameID != null) ids.add(preserved.abilityGameID);
  }
  return [...ids].sort((a, b) => a - b);
}

export function matchSpellIdsAgainstCatalog(
  catalog: AbilityCatalog,
  spellIds: number[],
): {
  matched: Array<{ spellId: number; rules: AbilityRule[] }>;
  unmatchedSpellIds: number[];
  ambiguousSpellIds: number[];
} {
  const matched: Array<{ spellId: number; rules: AbilityRule[] }> = [];
  const unmatchedSpellIds: number[] = [];
  const ambiguousSpellIds: number[] = [];

  for (const spellId of spellIds) {
    const rules = rulesForSpell(catalog, spellId);
    if (rules.length === 0) {
      unmatchedSpellIds.push(spellId);
      continue;
    }
    if (rules.length > 1) ambiguousSpellIds.push(spellId);
    matched.push({ spellId, rules });
  }

  return { matched, unmatchedSpellIds, ambiguousSpellIds };
}

function buildMatchedUsages(
  catalog: AbilityCatalog,
  spellIds: number[],
  categories: Set<AbilityCategory>,
  casts: Array<Record<string, unknown>>,
  buffs: Array<Record<string, unknown>>,
  attributedSourceIds: Set<number>,
): SurvivalMatchedAbilityUsage[] {
  const usages = new Map<string, SurvivalMatchedAbilityUsage>();

  for (const spellId of spellIds) {
    const rules = rulesForSpell(catalog, spellId).filter((r) => categories.has(r.category));
    for (const rule of rules) {
      const key = `${rule.canonicalKey}:${spellId}`;
      if (!usages.has(key)) {
        usages.set(key, {
          canonicalKey: rule.canonicalKey,
          category: rule.category,
          spellId,
          name: rule.name,
          sourceOwnership: rule.sourceOwnership,
          cooldownSeconds: rule.cooldownSeconds ?? null,
          availability: rule.availability,
          talentDependentOrUncertain: isTalentDependentOrUncertain(rule),
          castTimestamps: [],
          buffApplications: [],
          buffRemovals: [],
          sourceActorIds: [],
        });
      }
    }
  }

  for (const row of casts) {
    const preserved = preserveEventFields(row);
    const sourceId = preserved.sourceID;
    if (sourceId == null || !attributedSourceIds.has(sourceId)) continue;
    if (preserved.abilityGameID == null || preserved.timestamp == null) continue;
    for (const usage of usages.values()) {
      if (usage.spellId !== preserved.abilityGameID) continue;
      usage.castTimestamps.push(preserved.timestamp);
      if (!usage.sourceActorIds.includes(sourceId)) usage.sourceActorIds.push(sourceId);
    }
  }

  for (const row of buffs) {
    const preserved = preserveEventFields(row);
    const sourceId = preserved.sourceID;
    const targetId = preserved.targetID;
    if (preserved.abilityGameID == null) continue;
    const type = auraType(row);
    for (const usage of usages.values()) {
      if (usage.spellId !== preserved.abilityGameID) continue;
      const owned =
        (sourceId != null && attributedSourceIds.has(sourceId)) ||
        (targetId != null && attributedSourceIds.has(targetId));
      if (!owned) continue;
      const entry = {
        timestamp: preserved.timestamp,
        type,
        sourceID: sourceId,
        targetID: targetId,
      };
      if (type === "remove") usage.buffRemovals.push(entry);
      else usage.buffApplications.push(entry);
      if (sourceId != null && !usage.sourceActorIds.includes(sourceId)) {
        usage.sourceActorIds.push(sourceId);
      }
    }
  }

  return [...usages.values()].filter(
    (u) =>
      u.castTimestamps.length > 0 ||
      u.buffApplications.length > 0 ||
      u.buffRemovals.length > 0,
  );
}

function estimateItemLevel(gear: unknown): number | null {
  if (!Array.isArray(gear)) return null;
  const levels: number[] = [];
  for (const piece of gear) {
    if (!piece || typeof piece !== "object") continue;
    const ilvl = asFiniteNumber((piece as Record<string, unknown>).itemLevel);
    if (ilvl != null && ilvl > 0) levels.push(ilvl);
  }
  if (levels.length === 0) return null;
  return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
}

export function normalizeSurvivalDataset(input: {
  identity: SurvivalProbeIdentity;
  probedAt: string;
  candidate: SurvivalRunCandidate;
  wclCharacterId: number;
  wclCanonicalId: number;
  playerActorId: number;
  ownedPetActorIds: number[];
  fightStartTime: number;
  fightEndTime: number;
  keyLevel: number | null;
  encounterId: number | null;
  encounterName: string | null;
  eventDatasets: Record<SurvivalEventDataType, SurvivalRawEventDataset>;
  catalog: AbilityCatalog;
  classSlug: string | null;
  specSlug: string | null;
}): SurvivalNormalizedDataset {
  const attributed = new Set<number>([input.playerActorId, ...input.ownedPetActorIds]);
  const deathsRaw = input.eventDatasets.Deaths.state === "OK" ? input.eventDatasets.Deaths.events : [];
  const damageRaw =
    input.eventDatasets.DamageTaken.state === "OK" ? input.eventDatasets.DamageTaken.events : [];
  const castsRaw = input.eventDatasets.Casts.state === "OK" ? input.eventDatasets.Casts.events : [];
  const buffsRaw = input.eventDatasets.Buffs.state === "OK" ? input.eventDatasets.Buffs.events : [];
  const healingRaw =
    input.eventDatasets.Healing.state === "OK" ? input.eventDatasets.Healing.events : [];
  const combatantRaw =
    input.eventDatasets.CombatantInfo.state === "OK" ? input.eventDatasets.CombatantInfo.events : [];

  const playerDeaths: SurvivalDeathFact[] = [];
  for (const row of deathsRaw) {
    const preserved = preserveEventFields(row);
    const diedId = preserved.targetID ?? preserved.sourceID;
    if (diedId !== input.playerActorId) continue;
    playerDeaths.push({
      timestamp: preserved.timestamp,
      killingAbilityGameId: preserved.abilityGameID,
      killingSourceId: asFiniteNumber(row.killerID) ?? preserved.sourceID,
      overkill: preserved.overkill,
      event: preserved,
    });
  }

  const damageEvents = damageRaw
    .map(preserveEventFields)
    .filter((e) => e.targetID === input.playerActorId);

  let totalDamageTaken = 0;
  let totalAbsorbed = 0;
  const byAbilityMap = new Map<number, SurvivalDamageByAbility>();
  const bySourceMap = new Map<string, SurvivalDamageBySource>();

  for (const event of damageEvents) {
    const amount = event.amount ?? 0;
    const absorbed = event.absorbed ?? 0;
    totalDamageTaken += amount;
    totalAbsorbed += absorbed;

    const abilityId = event.abilityGameID ?? 0;
    const abilityRow = byAbilityMap.get(abilityId) ?? {
      abilityGameID: abilityId,
      eventCount: 0,
      totalAmount: 0,
      totalAbsorbed: 0,
      totalOverkill: 0,
    };
    abilityRow.eventCount += 1;
    abilityRow.totalAmount += amount;
    abilityRow.totalAbsorbed += absorbed;
    abilityRow.totalOverkill += event.overkill ?? 0;
    byAbilityMap.set(abilityId, abilityRow);

    const sourceKey = String(event.sourceID);
    const sourceRow = bySourceMap.get(sourceKey) ?? {
      sourceID: event.sourceID,
      eventCount: 0,
      totalAmount: 0,
      totalAbsorbed: 0,
    };
    sourceRow.eventCount += 1;
    sourceRow.totalAmount += amount;
    sourceRow.totalAbsorbed += absorbed;
    bySourceMap.set(sourceKey, sourceRow);
  }

  const spellIds = collectSpellIdsFromEvents(
    castsRaw,
    buffsRaw,
    healingRaw,
    attributed,
    input.playerActorId,
  );
  const catalogMatch = matchSpellIdsAgainstCatalog(input.catalog, spellIds);

  const defensiveUsage = buildMatchedUsages(
    input.catalog,
    spellIds,
    DEFENSIVE_CATEGORIES,
    castsRaw,
    buffsRaw,
    attributed,
  );
  const consumableAndSelfHealCasts = buildMatchedUsages(
    input.catalog,
    spellIds,
    SELF_HEAL_CONSUMABLE_CATEGORIES,
    castsRaw,
    buffsRaw,
    attributed,
  );

  const healingBySpell = new Map<number, SurvivalHealingFact>();
  for (const row of healingRaw) {
    const preserved = preserveEventFields(row);
    if (preserved.sourceID !== input.playerActorId) continue;
    if (preserved.targetID !== input.playerActorId) continue;
    if (preserved.abilityGameID == null) continue;
    const spellId = preserved.abilityGameID;
    const rules = rulesForSpell(input.catalog, spellId).filter(
      (r) => r.category === "SELF_HEAL" || r.category === "CONSUMABLE",
    );
    const existing = healingBySpell.get(spellId) ?? {
      spellId,
      canonicalKey: rules[0]?.canonicalKey ?? null,
      category: rules[0]?.category ?? null,
      catalogMatched: rules.length > 0,
      ambiguous: rules.length > 1,
      eventCount: 0,
      totalAmount: 0,
      totalOverheal: 0,
      timestamps: [],
    };
    existing.eventCount += 1;
    existing.totalAmount += preserved.amount ?? 0;
    existing.totalOverheal += asFiniteNumber(row.overheal) ?? 0;
    if (preserved.timestamp != null) existing.timestamps.push(preserved.timestamp);
    healingBySpell.set(spellId, existing);
  }

  const combatant = combatantRaw[0] ?? null;
  const gear = combatant?.gear ?? null;
  const talents = combatant?.talents ?? null;
  const specId = combatant ? asFiniteNumber(combatant.specID) : null;

  return {
    probeVersion: "1",
    probedAt: input.probedAt,
    identity: input.identity,
    run: {
      dungeonSlug: input.candidate.dungeonSlug,
      reportCode: input.candidate.reportCode,
      fightId: input.candidate.fightId,
      playerActorId: input.playerActorId,
      ownedPetActorIds: input.ownedPetActorIds,
      startTime: input.fightStartTime,
      endTime: input.fightEndTime,
      durationMs: Math.max(0, input.fightEndTime - input.fightStartTime),
      keyLevel: input.keyLevel,
      encounterId: input.encounterId,
      encounterName: input.encounterName,
      wclCharacterId: input.wclCharacterId,
      wclCanonicalId: input.wclCanonicalId,
    },
    deaths: {
      playerDeathCount: playerDeaths.length,
      deathTimestamps: playerDeaths
        .map((d) => d.timestamp)
        .filter((t): t is number => t != null),
      deaths: playerDeaths,
    },
    damageTaken: {
      totalDamageTaken,
      totalAbsorbed,
      byAbility: [...byAbilityMap.values()].sort((a, b) => b.totalAmount - a.totalAmount),
      bySource: [...bySourceMap.values()].sort((a, b) => b.totalAmount - a.totalAmount),
      events: damageEvents,
      avoidableClassification: null,
    },
    defensiveUsage,
    selfHealingAndConsumables: {
      healing: [...healingBySpell.values()].sort((a, b) => b.totalAmount - a.totalAmount),
      consumableAndSelfHealCasts,
    },
    combatantInfo: {
      specialization: input.specSlug,
      specId,
      talents,
      gear,
      itemLevel: estimateItemLevel(gear),
      raw: combatant,
    },
    abilityCatalog: {
      catalogVersion: input.catalog.catalogVersion,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      supported: input.catalog.supported,
      matchedSpellIds: catalogMatch.matched.map((m) => m.spellId),
      unmatchedSpellIds: catalogMatch.unmatchedSpellIds,
      ambiguousSpellIds: catalogMatch.ambiguousSpellIds,
    },
  };
}

export function describePetOwnership(
  actorMap: WclActorMap,
  playerActorId: number,
  playerName: string,
  ownedPetActorIds: number[],
): {
  method: string;
  pets: Array<{ id: number; name: string; subType: string | null; petOwner: number | null; reason: string }>;
} {
  const pets: Array<{
    id: number;
    name: string;
    subType: string | null;
    petOwner: number | null;
    reason: string;
  }> = [];
  let usedPetOwner = false;
  let usedHeuristic = false;
  const nameLower = playerName.toLowerCase();

  for (const petId of ownedPetActorIds) {
    const actor = actorMap.byId.get(petId);
    if (!actor) continue;
    let reason = "unknown";
    if (actor.petOwner === playerActorId) {
      reason = "petOwner";
      usedPetOwner = true;
    } else if (actor.name.toLowerCase().includes(nameLower)) {
      reason = "name_includes_player";
      usedHeuristic = true;
    } else {
      reason = "warlock_pet_subtype_heuristic";
      usedHeuristic = true;
    }
    pets.push({
      id: actor.id,
      name: actor.name,
      subType: actor.subType,
      petOwner: actor.petOwner,
      reason,
    });
  }

  const method =
    usedPetOwner && usedHeuristic
      ? "petOwner+heuristic"
      : usedPetOwner
        ? "petOwner"
        : usedHeuristic
          ? "heuristic"
          : ownedPetActorIds.length === 0
            ? "none"
            : "unknown";

  return { method, pets };
}

export function emptyRejection(
  candidate: Pick<SurvivalRunCandidate, "reportCode" | "fightId" | "dungeonSlug">,
  reason: string,
): SurvivalCandidateRejection {
  return {
    reportCode: candidate.reportCode,
    fightId: candidate.fightId,
    dungeonSlug: candidate.dungeonSlug,
    reason,
  };
}

export function classSlugFromWclClassId(classId: number | null | undefined): string | null {
  if (classId == null) return null;
  return WCL_CLASS_ID_TO_SLUG[classId] ?? null;
}

export function normalizeSpecSlug(spec: string | null | undefined): string | null {
  if (!spec) return null;
  return spec
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");
}
