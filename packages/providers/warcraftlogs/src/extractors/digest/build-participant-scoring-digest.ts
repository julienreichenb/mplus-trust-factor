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
import { buildOffensiveParticipantActivationReports } from "../offensive/activations.js";
import { extractUtilityActionTimeline } from "../utility/extract-actions.js";
import { extractSurvivalFromCapabilityPackage } from "../survival/extract.js";

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

  const participants = input.participants.map((p) => ({
    playerActorId: p.playerActorId,
    characterName: p.characterName,
    realmSlug: p.realmSlug ?? "unknown",
    regionCode: p.regionCode ?? input.region ?? "unknown",
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
    const personalDefensives = survival.timeline.activations.filter(
      (a) =>
        a.participantActorId === actorId && a.activationKind === "PERSONAL_DEFENSIVE",
    );
    const recoveries = survival.timeline.activations.filter(
      (a) => a.participantActorId === actorId && a.activationKind === "RECOVERY",
    );
    const externals = survival.timeline.activations.filter(
      (a) =>
        a.participantActorId === actorId &&
        a.activationKind === "EXTERNAL_DEFENSIVE_RECEIVED",
    );
    const deaths = survival.timeline.deaths.filter((d) => d.participantActorId === actorId);
    const pressureWindows = survival.timeline.pressureWindows.filter(
      (w) => w.participantActorId === actorId,
    );

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
      classSlug: participant.classSlug,
      specSlug: participant.specSlug,
      role: mapRole(participant.role),
      ownedPetActorIds: [...participant.ownedPetActorIds],
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
          timestampMs: a.timestampMs,
          fightOffsetMs:
            input.fightStartMs != null
              ? Math.max(0, a.timestampMs - input.fightStartMs)
              : undefined,
          rawMatchedEventCount: a.rawMatchedEventCount,
          contributingSpellIds: a.contributingSpellIds,
        })),
        completeness: performanceCompleteness,
        limitations: [
          ...(ranking == null || ranking.parseSemantic === "UNAVAILABLE"
            ? ["ranking_parse_absent"]
            : []),
          ...(offensive?.activations.length === 0
            ? ["no_offensive_activations"]
            : []),
        ],
      },
      utility: {
        actions: utilityActions,
        capabilityCompleteness: utilityCompleteness,
        completeness: completenessFromStatuses(
          utilityCompleteness.map((c) => c.status),
        ),
        limitations: [
          ...utility.timeline.limitations,
          ...(utilityActions.length === 0 ? ["no_utility_actions_for_participant"] : []),
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
        fightDurationMs,
        activeCombatMs: fightDurationMs,
        capabilityCompleteness: survivalCompleteness,
        completeness: completenessFromStatuses(
          survivalCompleteness.map((c) => c.status),
        ),
        limitations: [
          ...survival.timeline.limitations,
          ...(survivalSummary?.limitations ?? []),
        ],
      },
      createdAt,
    });
  });
}
