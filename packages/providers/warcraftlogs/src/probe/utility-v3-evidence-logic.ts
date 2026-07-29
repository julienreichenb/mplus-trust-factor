import type { AbilityCatalog } from "@mplus/abilities";
import { getAbilityCatalog } from "@mplus/abilities";
import {
  attributedSourceIds,
  isFriendlyActor,
  isHostileActor,
  preserveUtilityEvent,
} from "./utility-probe-logic.js";
import type { UtilityActorContext, UtilityNormalizedRun } from "./utility-probe-types.js";
import { auditUtilityV2Run } from "./utility-v2-audit-logic.js";
import type { UtilityV2DomainEvidenceSummary, UtilityV2EvidenceItem, UtilityV2RawRunBundle } from "./utility-v2-types.js";
import { UTILITY_V3_SIMULATION_CONFIG, type UtilityV3DomainKey } from "./utility-v3-config.js";

const DOMAIN_KEYS = Object.keys(
  UTILITY_V3_SIMULATION_CONFIG.domainWeights,
) as UtilityV3DomainKey[];

function emptyTierCounts() {
  return { CONFIRMED_IMPACT: 0, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 };
}

function eventType(row: Record<string, unknown>): string {
  const t = row.type;
  return typeof t === "string" ? t.toLowerCase() : "";
}

function hostileActorCastInRun(
  targetId: number,
  casts: Array<Record<string, unknown>>,
  actorCtx: UtilityActorContext,
  fightId: number,
  reportCode: string,
): boolean {
  const meta = { fightId, reportCode, actorCtx };
  for (const row of casts) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.sourceID !== targetId || preserved.timestamp == null) continue;
    const typ = eventType(row);
    if (typ.includes("cast") || typ.includes("begincast")) return true;
  }
  return false;
}

function ruleSpellIds(rule: { spellIds: number[]; aliases?: number[] }): Set<number> {
  return new Set<number>([...rule.spellIds, ...(rule.aliases ?? [])]);
}

function casterControlSpellIdsFromCatalog(catalog: AbilityCatalog): Set<number> {
  const out = new Set<number>();
  for (const rule of catalog.rules) {
    if (!rule.canonicalKey.includes("caster-control")) continue;
    for (const id of ruleSpellIds(rule)) out.add(id);
  }
  return out;
}

function demonicGatewaySpellIdsFromCatalog(catalog: AbilityCatalog): {
  castIds: Set<number>;
  auraIds: Set<number>;
} {
  const castIds = new Set<number>();
  const auraIds = new Set<number>();
  for (const rule of catalog.rules) {
    if (!rule.canonicalKey.includes("demonic-gateway") && rule.name !== "Demonic Gateway") continue;
    for (const id of rule.spellIds) castIds.add(id);
    for (const id of rule.aliases ?? []) auraIds.add(id);
  }
  return { castIds, auraIds };
}

function upgradeCasterControlEvidence(
  items: UtilityV2EvidenceItem[],
  raw: UtilityV2RawRunBundle,
  actorCtx: UtilityActorContext,
  normalized: UtilityNormalizedRun,
  catalog: AbilityCatalog,
): UtilityV2EvidenceItem[] {
  const spellIds = casterControlSpellIdsFromCatalog(catalog);
  if (spellIds.size === 0) return items;
  const casterIds = hostileCasterIdsInRun(raw.casts, actorCtx, normalized.fightId, normalized.reportCode);
  const out = items.map((item) => ({ ...item }));

  for (const item of out) {
    if (item.domain !== "casterControl" || item.tier !== "RAW_CAST") continue;
    if (item.abilityGameID == null || !spellIds.has(item.abilityGameID)) continue;

    const targetId = item.targetActorId;
    const hostileTarget =
      targetId != null &&
      targetId > 0 &&
      (isHostileActor(targetId, actorCtx) || casterIds.has(targetId));
    const wclEnvironmentTarget = targetId === -1 || targetId == null;

    if (hostileTarget && (casterIds.has(targetId!) || hostileActorCastInRun(
      targetId!,
      raw.casts,
      actorCtx,
      normalized.fightId,
      normalized.reportCode,
    ))) {
      item.tier = "CONFIRMED_APPLICATION";
      item.confidence = "MEDIUM";
      item.observability = "PARTIAL";
      item.correlationNotes = [
        ...item.correlationNotes,
        "hostile_caster_known_in_run_application_credit",
      ];
    } else if (wclEnvironmentTarget) {
      item.tier = "CONFIRMED_APPLICATION";
      item.confidence = "MEDIUM";
      item.observability = "PARTIAL";
      item.correlationNotes = [
        ...item.correlationNotes,
        "wcl_environment_target_tongues_cast_application_credit",
      ];
    }
  }

  return out;
}

function hostileCasterIdsInRun(
  casts: Array<Record<string, unknown>>,
  actorCtx: UtilityActorContext,
  fightId: number,
  reportCode: string,
): Set<number> {
  const meta = { fightId, reportCode, actorCtx };
  const ids = new Set<number>();
  for (const row of casts) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.sourceID == null || !isHostileActor(preserved.sourceID, actorCtx)) continue;
    const typ = eventType(row);
    if (typ.includes("cast") || typ.includes("begincast")) ids.add(preserved.sourceID);
  }
  return ids;
}

function addGatewayGroupUsageEvidence(
  items: UtilityV2EvidenceItem[],
  raw: UtilityV2RawRunBundle,
  actorCtx: UtilityActorContext,
  normalized: UtilityNormalizedRun,
  catalog: AbilityCatalog,
): UtilityV2EvidenceItem[] {
  const out = [...items];
  const meta = { fightId: normalized.fightId, reportCode: normalized.reportCode, actorCtx };
  const attributed = attributedSourceIds(actorCtx);

  const { castIds, auraIds } = demonicGatewaySpellIdsFromCatalog(catalog);
  if (castIds.size === 0 || auraIds.size === 0) return out;

  const gatewayAuraPrimaryId =
    [...auraIds].sort((a, b) => a - b)[0] ?? null;

  const gatewayCastTs: number[] = [];
  for (const row of raw.casts) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.sourceID == null || !attributed.has(preserved.sourceID)) continue;
    if (!castIds.has(preserved.abilityGameID ?? -1) || preserved.timestamp == null) continue;
    if (!eventType(row).includes("cast")) continue;
    gatewayCastTs.push(preserved.timestamp);
  }

  for (const castTs of gatewayCastTs) {
    const partyUsers = new Set<number>();
    for (const row of [...raw.buffs, ...raw.debuffs]) {
      const preserved = preserveUtilityEvent(row, meta);
      if (preserved.timestamp == null || !auraIds.has(preserved.abilityGameID ?? -1)) continue;
      if (!eventType(row).includes("apply")) continue;
      if (Math.abs(preserved.timestamp - castTs) > UTILITY_V3_SIMULATION_CONFIG.gatewayGroupUsage.pairingWindowMs) continue;
      if (preserved.targetID == null) continue;
      if (!isFriendlyActor(preserved.targetID, actorCtx)) continue;
      partyUsers.add(preserved.targetID);
    }

    if (partyUsers.size >= UTILITY_V3_SIMULATION_CONFIG.gatewayGroupUsage.minUniquePartyUsers) {
      out.push({
        id: `${normalized.reportCode}:${normalized.fightId}:gw-group:${castTs}`,
        domain: "groupMobility",
        kind: "GROUP_MOBILITY_TRAVERSAL",
        tier: "CONFIRMED_IMPACT",
        timestamp: castTs,
        abilityGameID: gatewayAuraPrimaryId,
        abilityName: "Demonic Gateway",
        targetActorId: null,
        interruptedSpellId: null,
        removedSpellId: null,
        durationMs: null,
        correlationNotes: [
          "unique_party_aura_users_per_gateway_cast",
          `unique_users:${partyUsers.size}`,
        ],
        confidence: "HIGH",
        observability: "FULL",
      });
    }
  }

  return dedupeEvidence(out);
}

function dedupeEvidence(items: UtilityV2EvidenceItem[]): UtilityV2EvidenceItem[] {
  const rank = { CONFIRMED_IMPACT: 3, CONFIRMED_APPLICATION: 2, RAW_CAST: 1 };
  const byKey = new Map<string, UtilityV2EvidenceItem>();
  for (const item of items) {
    const key = `${item.domain}:${item.kind}:${item.timestamp}:${item.abilityGameID}:${item.targetActorId}`;
    const existing = byKey.get(key);
    if (!existing || rank[item.tier] > rank[existing.tier]) byKey.set(key, item);
  }
  return [...byKey.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function resummarizeDomain(
  domain: UtilityV3DomainKey,
  items: UtilityV2EvidenceItem[],
  durationHours: number,
  prior: UtilityV2DomainEvidenceSummary,
): UtilityV2DomainEvidenceSummary {
  const tierCounts = emptyTierCounts();
  for (const item of items.filter((i) => i.domain === domain)) {
    tierCounts[item.tier] += 1;
  }
  const hours = Math.max(durationHours, 1 / 60);
  const normalizedRatesPerHour = {
    CONFIRMED_IMPACT: tierCounts.CONFIRMED_IMPACT / hours,
    CONFIRMED_APPLICATION: tierCounts.CONFIRMED_APPLICATION / hours,
    RAW_CAST: tierCounts.RAW_CAST / hours,
  };

  return {
    ...prior,
    domain,
    tierCounts,
    items: items.filter((i) => i.domain === domain),
    normalizedRatesPerHour,
  };
}

export function auditUtilityV3Evidence(input: {
  normalized: UtilityNormalizedRun;
  raw: UtilityV2RawRunBundle;
  masterActors: Array<{
    id: number;
    name: string;
    type: string;
    subType?: string | null;
    petOwner?: number | null;
  }>;
  damageEvents?: Array<Record<string, unknown>>;
}) {
  const catalog = getAbilityCatalog({
    classSlug: input.normalized.classSlug,
    specSlug: input.normalized.specialization,
    includeRacials: true,
  });
  const v2Run = auditUtilityV2Run({
    normalized: input.normalized,
    raw: input.raw,
    masterActors: input.masterActors,
    damageEvents: input.damageEvents,
    catalog,
  });

  const durationHours = v2Run.durationHours;
  let allItems = DOMAIN_KEYS.flatMap((d) => v2Run.domains[d].items);

  const actorCtx = {
    playerActorId: input.normalized.playerActorId,
    ownedPetActorIds: input.normalized.petActorIds,
    friendlyPlayerIds: input.masterActors
      .filter((a) => a.type === "Player" && a.id !== input.normalized.playerActorId)
      .map((a) => a.id),
    actorsById: new Map(
      input.masterActors.map((a) => [
        a.id,
        {
          id: a.id,
          name: a.name,
          type: a.type,
          subType: a.subType ?? null,
          petOwner: a.petOwner ?? null,
        },
      ]),
    ),
    hostileValidatedByDamage: new Set<number>(),
  };

  allItems = upgradeCasterControlEvidence(
    allItems,
    input.raw,
    actorCtx,
    input.normalized,
    catalog,
  );
  allItems = addGatewayGroupUsageEvidence(
    allItems,
    input.raw,
    actorCtx,
    input.normalized,
    catalog,
  );
  allItems = dedupeEvidence(allItems);

  const domains = Object.fromEntries(
    DOMAIN_KEYS.map((d) => [
      d,
      resummarizeDomain(d, allItems, durationHours, v2Run.domains[d]),
    ]),
  ) as Record<UtilityV3DomainKey, UtilityV2DomainEvidenceSummary>;

  return {
    runId: v2Run.runId,
    reportCode: v2Run.reportCode,
    fightId: v2Run.fightId,
    dungeonSlug: v2Run.dungeonSlug,
    durationMs: v2Run.durationMs,
    durationHours,
    domains,
    missedInterruptOpportunities: v2Run.missedInterruptOpportunities,
    evidenceInventory: allItems,
  };
}
