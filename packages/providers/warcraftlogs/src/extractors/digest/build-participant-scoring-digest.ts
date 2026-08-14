/**
 * Build ParticipantScoringDigestV1 for all fight participants from one shared
 * CapabilityEvidencePackageV1 (provider-free).
 */
import { CURRENT_CATALOG_VERSION_ID, type AbilityRole } from "@mplus/abilities";
import {
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
  withParticipantDigestContentHash,
  type CapabilityEvidencePackageV1,
  type ParticipantScoringDigestV1,
  type UtilityCanonicalAction,
} from "@mplus/contracts";
import { estimateActiveCombatMs } from "@mplus/scoring";
import { extractParticipantLoadoutsFromCombatantEvents } from "../../evidence/capability/combatant-loadout.js";
import { buildOffensiveParticipantActivationReports } from "../offensive/activations.js";
import { extractUtilityActionTimeline } from "../utility/extract-actions.js";
import { extractSurvivalFromCapabilityPackage } from "../survival/extract.js";
import { extractSurvivalActiveHealingEvents } from "../survival/extract-active-healing.js";

export interface RankingParseFactInput {
  parsePercentile: number | null;
  parseSemantic: "BRACKET_PERCENT" | "RANK_PERCENT" | "UNAVAILABLE";
  partition: number | null;
  rawDps: number | null;
  rankingProvenance?: {
    providerContractVersion: string;
    schemaVersion: string;
    artifactId: string | null;
    contentHash: string | null;
    source: "PERSISTED_RANKING_PARSE" | "ABSENT";
  };
}

/**
 * Infer fight-local bounds from compact-event timestamps (report-absolute).
 * Prefer authoritative WCL fight.startTime/endTime when available; this is the
 * provider-free fallback so duration is not inflated as max(ts) − 0.
 */
export function inferFightBoundsFromCompactEvents(
  compactEvents: ReadonlyArray<{ timestampMs: number }>,
): { fightStartMs: number; fightEndMs: number | null } {
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  for (const e of compactEvents) {
    if (!Number.isFinite(e.timestampMs)) continue;
    if (e.timestampMs < minTs) minTs = e.timestampMs;
    if (e.timestampMs > maxTs) maxTs = e.timestampMs;
  }
  if (!(minTs < Number.POSITIVE_INFINITY) || !(maxTs > Number.NEGATIVE_INFINITY)) {
    return { fightStartMs: 0, fightEndMs: null };
  }
  return { fightStartMs: minTs, fightEndMs: maxTs };
}

export interface BuildParticipantDigestsFromPackageInput {
  capabilityPackage: CapabilityEvidencePackageV1;
  packageArtifactId: string;
  participants: Array<{
    playerActorId: number;
    characterName: string;
    realmSlug?: string;
    regionCode?: string;
    classSlug: string | null;
    specSlug: string | null;
    role?: AbilityRole | string | null;
    ownedPetActorIds: number[];
    characterId?: string | null;
  }>;
  dungeonSlug: string | null;
  keyLevel: number | null;
  timed: boolean | null;
  runScore: number | null;
  completedAt: string | null;
  fightStartMs: number;
  fightEndMs: number | null;
  region?: string | null;
  /** Per-actor ranking/parse facts when available (keyed by playerActorId). */
  rankingByActorId?: Map<number, RankingParseFactInput>;
  catalogVersion?: string;
  createdAt?: string;
  /**
   * Optional CombatantInfo rows when package.participantLoadouts is empty
   * (recover loadout proof without a second WCL fetch).
   */
  combatantInfoEvents?: ReadonlyArray<Record<string, unknown>> | null;
}


function compactEventsToRawRows(
  pkg: CapabilityEvidencePackageV1,
  datasets: readonly string[],
): Partial<Record<string, Array<Record<string, unknown>>>> {
  const out: Partial<Record<string, Array<Record<string, unknown>>>> = {};
  for (const ds of datasets) out[ds] = [];
  for (const event of pkg.compactEvents) {
    if (!datasets.includes(event.dataset)) continue;
    const rows = out[event.dataset] ?? (out[event.dataset] = []);
    rows.push({
      timestamp: event.timestampMs,
      type: event.eventType,
      abilityGameID: event.spellId,
      sourceID: event.sourceActorId,
      targetID: event.targetActorId,
      amount: event.amount ?? undefined,
      ability: event.rawName ? { name: event.rawName, guid: event.spellId } : undefined,
    });
  }
  return out;
}

function completenessFromStatuses(
  statuses: Array<"COMPLETE" | "INCOMPLETE" | "UNAVAILABLE" | undefined>,
): "COMPLETE" | "PARTIAL" | "UNAVAILABLE" {
  if (statuses.length === 0) return "UNAVAILABLE";
  if (statuses.every((s) => s === "COMPLETE")) return "COMPLETE";
  if (statuses.every((s) => s === "UNAVAILABLE")) return "UNAVAILABLE";
  return "PARTIAL";
}

function mapRole(
  role: AbilityRole | string | null | undefined,
): ParticipantScoringDigestV1["role"] {
  if (role === "TANK" || role === "HEALER" || role === "DPS") return role;
  if (role == null) return null;
  return "UNKNOWN";
}

/** Durable digest identity: real slug or null — never the sentinel "unknown". */
function durableIdentitySlug(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;
  return trimmed;
}


/**
 * Produce one digest per participant from a shared capability package.
 * Zero provider calls.
 */
export function buildParticipantScoringDigestsFromPackage(
  input: BuildParticipantDigestsFromPackageInput,
): ParticipantScoringDigestV1[] {
  const catalogVersion = input.catalogVersion ?? CURRENT_CATALOG_VERSION_ID;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const pkg = input.capabilityPackage;
  const source = {
    reportCode: pkg.sourceKey.reportCode,
    fightId: pkg.sourceKey.fightId,
    reportRevision: pkg.sourceKey.reportRevision,
    dungeonSlug: input.dungeonSlug,
    keyLevel: input.keyLevel,
    fightStartMs: input.fightStartMs,
    fightEndMs: input.fightEndMs,
    region: input.region ?? null,
  };

  // Extractors still require string realm/region; digests store null when absent.
  const participants = input.participants.map((p) => ({
    playerActorId: p.playerActorId,
    characterName: p.characterName,
    realmSlug: durableIdentitySlug(p.realmSlug) ?? "unknown",
    regionCode:
      durableIdentitySlug(p.regionCode) ??
      durableIdentitySlug(input.region) ??
      "unknown",
    classSlug: p.classSlug,
    specSlug: p.specSlug,
    role: (p.role as AbilityRole | null) ?? null,
    ownedPetActorIds: p.ownedPetActorIds,
  }));

  const survival = extractSurvivalFromCapabilityPackage({
    source,
    participants,
    capabilityPackage: pkg,
    packageArtifactId: input.packageArtifactId,
    catalogVersion,
  });

  const utilityEvents = compactEventsToRawRows(pkg, [
    "Interrupts",
    "Dispels",
    "Casts",
    "Debuffs",
    "Buffs",
  ]);
  const utility = extractUtilityActionTimeline({
    source,
    participants,
    eventsByDataset: utilityEvents,
    catalogVersion,
    coverage: pkg.coverage.map((c) => ({
      datasetKey: c.requiredDatasets[0] ?? "unknown",
      pageCount: c.pageCount,
      eventCount: c.eventCount,
      complete: c.complete,
      truncated: !c.complete,
      stopReason: c.stopReason,
      coverageRatio: null,
    })),
  });

  const offensiveEvents = compactEventsToRawRows(pkg, ["Casts", "Buffs"]);
  const offensiveReports = buildOffensiveParticipantActivationReports({
    participants,
    casts: offensiveEvents.Casts ?? [],
    buffs: offensiveEvents.Buffs ?? [],
  });
  const offensiveByActor = new Map(
    offensiveReports.map((r) => [r.playerActorId, r] as const),
  );

  const fightDurationMs =
    input.fightEndMs != null && input.fightStartMs != null
      ? Math.max(0, input.fightEndMs - input.fightStartMs)
      : null;

  const packageLoadouts = pkg.participantLoadouts ?? [];
  const fallbackLoadouts =
    packageLoadouts.length === 0 &&
    input.combatantInfoEvents != null &&
    input.combatantInfoEvents.length > 0
      ? extractParticipantLoadoutsFromCombatantEvents(
          input.combatantInfoEvents,
          new Set(input.participants.map((p) => p.playerActorId)),
        )
      : [];
  const loadoutsByActor = new Map(
    (packageLoadouts.length > 0 ? packageLoadouts : fallbackLoadouts).map(
      (l) => [l.actorId, l] as const,
    ),
  );

  return input.participants.map((participant) => {
    const actorId = participant.playerActorId;
    const ranking = input.rankingByActorId?.get(actorId);
    const offensive = offensiveByActor.get(actorId);
    const survivalSummary = survival.timeline.participants.find(
      (p) => p.playerActorId === actorId,
    );
    const utilityActions: UtilityCanonicalAction[] = utility.timeline.actions.filter(
      (a) => a.ownerActorId === actorId,
    );
    const hostileCastEvents = pkg.compactEvents
      .filter((e) => e.capabilities.includes("UTILITY_HOSTILE_CASTS"))
      .map((e) => ({
        eventId: e.eventId,
        timestampMs: e.timestampMs,
        fightOffsetMs: Math.max(0, e.timestampMs - input.fightStartMs),
        spellId: e.spellId,
        eventType: e.eventType,
        sourceActorId: e.sourceActorId,
        targetActorId: e.targetActorId,
      }));
    const personalDefensives = survival.timeline.activations.filter(
      (a) =>
        a.participantActorId === actorId && a.activationKind === "PERSONAL_DEFENSIVE",
    );
    const recoveries = survival.timeline.activations.filter(
      (a) => a.participantActorId === actorId && a.activationKind === "RECOVERY",
    );
    const activeHealingEvents = extractSurvivalActiveHealingEvents({
      compactEvents: pkg.compactEvents,
      participantActorId: actorId,
      friendlyPlayerActorIds: pkg.friendlyPlayerActorIds,
      classSlug: participant.classSlug,
      specSlug: participant.specSlug ?? null,
    });
    const externals = survival.timeline.activations.filter(
      (a) =>
        a.participantActorId === actorId &&
        a.activationKind === "EXTERNAL_DEFENSIVE_RECEIVED",
    );
    const deaths = survival.timeline.deaths.filter((d) => d.participantActorId === actorId);
    const pressureWindows = survival.timeline.pressureWindows.filter(
      (w) => w.participantActorId === actorId,
    );

    const loadoutFromPackage = loadoutsByActor.get(actorId);
    const loadoutEvidence: ParticipantScoringDigestV1["loadoutEvidence"] =
      loadoutFromPackage != null
        ? {
            evidenceState: loadoutFromPackage.evidenceState,
            talentSpellIds: [...loadoutFromPackage.talentSpellIds],
            talentTreeNodeIds: [...(loadoutFromPackage.talentTreeNodeIds ?? [])],
            blizzardSpecId: loadoutFromPackage.blizzardSpecId,
            source: "COMBATANT_INFO",
            raceSlug: loadoutFromPackage.raceSlug ?? null,
            raceEvidenceState: loadoutFromPackage.raceEvidenceState ?? "UNKNOWN",
          }
        : {
            evidenceState: "ABSENT",
            talentSpellIds: [],
            talentTreeNodeIds: [],
            blizzardSpecId: null,
            source: "ABSENT",
            raceSlug: null,
            raceEvidenceState: "UNKNOWN",
          };

    // Survival pressure clock: personal damage-taken activity (unchanged).
    const damageTimestampsMs =
      fightDurationMs != null && fightDurationMs > 0
        ? input.capabilityPackage.compactEvents
            .filter(
              (e) =>
                e.capabilities.includes("SURVIVAL_DAMAGE_TAKEN") &&
                (e.targetPlayerActorId === actorId || e.targetActorId === actorId),
            )
            .map((e) => Math.max(0, e.timestampMs - input.fightStartMs))
        : [];
    const survivalActiveCombatEstimate =
      fightDurationMs != null && fightDurationMs > 0
        ? estimateActiveCombatMs({
            fightDurationMs,
            hostileEventTimestampsMs: damageTimestampsMs,
          })
        : null;
    const activeCombatMs =
      survivalActiveCombatEstimate?.activeCombatMs ?? fightDurationMs;
    const activeCombatLimitations =
      survivalActiveCombatEstimate?.method === "fight_duration_fallback"
        ? ["active_combat_fallback_fight_duration"]
        : [];

    // Run-level offensive cadence clock: prefer party-wide hostile casts, else fight bounds.
    const hostileCastTimestampsMs =
      fightDurationMs != null && fightDurationMs > 0
        ? hostileCastEvents.map((e) => e.fightOffsetMs)
        : [];
    const runActiveCombatEstimate =
      fightDurationMs != null && fightDurationMs > 0
        ? estimateActiveCombatMs({
            fightDurationMs,
            hostileEventTimestampsMs: hostileCastTimestampsMs,
          })
        : null;
    const performanceActiveCombatMs =
      runActiveCombatEstimate?.activeCombatMs ?? fightDurationMs;
    const performanceActiveCombatMethod =
      runActiveCombatEstimate?.method === "hostile_activity_windows"
        ? ("hostile_cast_activity" as const)
        : fightDurationMs != null
          ? ("fight_duration_fallback" as const)
          : null;

    const utilityCompleteness = utility.timeline.capabilityCompleteness;
    const survivalCompleteness =
      survivalSummary?.capabilityCompleteness ?? survival.timeline.capabilityCompleteness;

    const performanceCompleteness: ParticipantScoringDigestV1["performance"]["completeness"] =
      ranking != null &&
      ranking.parseSemantic !== "UNAVAILABLE" &&
      ranking.parsePercentile != null
        ? "COMPLETE"
        : "UNAVAILABLE";

    return withParticipantDigestContentHash({
      schemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
      reportCode: pkg.sourceKey.reportCode,
      fightId: pkg.sourceKey.fightId,
      reportRevision: pkg.sourceKey.reportRevision,
      dungeonSlug: input.dungeonSlug,
      keyLevel: input.keyLevel,
      timed: input.timed,
      runScore: input.runScore,
      completedAt: input.completedAt,
      participantActorId: actorId,
      characterId: participant.characterId ?? null,
      characterName: participant.characterName,
      realmSlug: durableIdentitySlug(participant.realmSlug),
      regionCode: durableIdentitySlug(
        participant.regionCode ?? input.region ?? null,
      ),
      classSlug: participant.classSlug,
      specSlug: participant.specSlug,
      role: mapRole(participant.role),
      ownedPetActorIds: [...participant.ownedPetActorIds],
      loadoutEvidence,
      capabilityPackageArtifactId: input.packageArtifactId,
      capabilityPackageContentHash: pkg.contentHash,
      catalogVersion,
      extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
      performance: {
        parsePercentile: ranking?.parsePercentile ?? null,
        parseSemantic: ranking?.parseSemantic ?? "UNAVAILABLE",
        partition: ranking?.partition ?? null,
        rawDps: ranking?.rawDps ?? null,
        rankingProvenance: ranking?.rankingProvenance ?? {
          providerContractVersion: "wcl-ranking-parse-v1",
          schemaVersion: "1.0.0",
          artifactId: null,
          contentHash: null,
          source: "ABSENT",
        },
        offensiveActivations: (offensive?.activations ?? []).map((a) => ({
          activationId: a.activationId,
          canonicalKey: a.canonicalKey,
          primarySpellId: a.primarySpellId,
          observedSpellIds:
            a.observedSpellIds.length > 0
              ? a.observedSpellIds
              : a.contributingSpellIds.length > 0
                ? a.contributingSpellIds
                : [a.primarySpellId],
          timestampMs: a.timestampMs,
          fightOffsetMs:
            input.fightStartMs != null
              ? Math.max(0, a.timestampMs - input.fightStartMs)
              : undefined,
          rawMatchedEventCount: a.rawMatchedEventCount,
          contributingSpellIds: a.contributingSpellIds,
          targetActorId: a.targetActorId,
        })),
        activeCombatMs: performanceActiveCombatMs,
        activeCombatMethod: performanceActiveCombatMethod,
        completeness: performanceCompleteness,
        limitations: [
          ...(ranking == null || ranking.parseSemantic === "UNAVAILABLE"
            ? ["ranking_parse_absent"]
            : []),
          ...(offensive?.activations.length === 0
            ? ["no_offensive_activations"]
            : []),
          ...(performanceActiveCombatMethod === "fight_duration_fallback"
            ? ["performance_active_combat_fallback_fight_duration"]
            : []),
          ...(loadoutEvidence.evidenceState === "ABSENT"
            ? ["loadout_evidence_absent"]
            : []),
          ...(loadoutEvidence.evidenceState === "UNPARSEABLE"
            ? ["loadout_evidence_unparseable"]
            : []),
        ],
      },
      utility: {
        actions: utilityActions,
        hostileCastEvents,
        capabilityCompleteness: utilityCompleteness,
        completeness: completenessFromStatuses(
          utilityCompleteness.map((c) => c.status),
        ),
        limitations: [
          ...utility.timeline.limitations,
          ...(utilityActions.length === 0 ? ["no_utility_actions_for_participant"] : []),
          ...(hostileCastEvents.length === 0
            ? ["hostile_cast_events_absent_in_package"]
            : []),
        ],
      },
      survival: {
        damageTakenTotal: survivalSummary?.damageTakenTotal ?? 0,
        damageTakenEventCount: survivalSummary?.damageTakenEventCount ?? 0,
        deaths,
        personalDefensiveActivations: personalDefensives,
        recoveryActivations: recoveries,
        externalsReceived: externals,
        pressureWindows,
        activeHealingEvents,
        fightDurationMs,
        activeCombatMs,
        capabilityCompleteness: survivalCompleteness,
        completeness: completenessFromStatuses(
          survivalCompleteness.map((c) => c.status),
        ),
        limitations: [
          ...survival.timeline.limitations,
          ...(survivalSummary?.limitations ?? []),
          ...activeCombatLimitations,
        ],
      },
      createdAt,
    });
  });
}
