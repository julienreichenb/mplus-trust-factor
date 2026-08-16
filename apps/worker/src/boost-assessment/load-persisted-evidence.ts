/**
 * Provider-free Boost replay loader.
 *
 * Primary 16-run identity: CharacterScore.selectedRuns from the last scoring
 * operation (same objects scoreCharacter persisted from orchestration digests).
 * EvidenceManifest is only a canary/replay fallback, never a Boost selector.
 */
import type { PrismaClient } from "@mplus/database";
import type { AppliedScoreContext, CharacterSeasonEvidenceManifestV2, EvidenceSlotV2 } from "@mplus/contracts";
import type { BoostDungeonContext, BoostRunInput, SeasonHighKeyContext } from "@mplus/scoring";
import { attachRankingSnapshot } from "./attach-ranking-snapshot.js";
import { loadBoostDungeonContexts } from "./load-dungeon-contexts.js";
import { seasonHighKeyContextFromApplied } from "./season-high-key-context.js";

export type BoostSlotMissingClass =
  | "SCORING_SELECTION_LINEAGE_MISSING"
  | "CANONICAL_SLOT_MISSING"
  | "NO_WCL_SOURCE"
  | "NO_COMPATIBLE_RAW"
  | "AMBIGUOUS_RAW_ALIGNMENT"
  | "NO_RANKING_SNAPSHOT"
  | "INCOMPATIBLE_RANKING_SEMANTIC"
  | "SUBJECT_ACTOR_UNALIGNED"
  | "SUBJECT_BRACKET_PERCENT_MISSING"
  | "AMBIGUOUS_WCL_ALIGNMENT"
  | "MISSING_SEASON_CONTEXT"
  | "CANONICAL_EIGHT_RUN_SELECTION_MISSING";

export interface BoostLineageSlot {
  slotId: string;
  slotIndex: number;
  dungeonSlug: string;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  participantActorId: number | null;
  keyLevel: number | null;
  rawRunId: string | null;
  rankingSnapshotId: string | null;
  missingClass: BoostSlotMissingClass | null;
}

export interface ScoringSelectedRunRow {
  slotId: string;
  dungeonSlug: string;
  slotIndex: number;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  participantActorId: number | null;
  keyLevel: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseSelectedRuns(value: unknown): ScoringSelectedRunRow[] {
  if (!Array.isArray(value)) return [];
  const out: ScoringSelectedRunRow[] = [];
  for (const raw of value) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const slotId = typeof rec.slotId === "string" ? rec.slotId : null;
    const dungeonSlug = typeof rec.dungeonSlug === "string" ? rec.dungeonSlug : null;
    if (!slotId || !dungeonSlug) continue;
    out.push({
      slotId,
      dungeonSlug,
      slotIndex: typeof rec.slotIndex === "number" ? rec.slotIndex : 0,
      reportCode: typeof rec.reportCode === "string" ? rec.reportCode : null,
      fightId: typeof rec.fightId === "number" ? rec.fightId : null,
      reportRevision: typeof rec.reportRevision === "number" ? rec.reportRevision : null,
      participantActorId: typeof rec.participantActorId === "number" ? rec.participantActorId : null,
      keyLevel: typeof rec.keyLevel === "number" && Number.isFinite(rec.keyLevel) ? rec.keyLevel : null,
    });
  }
  return out;
}

function slotsFromManifest(document: CharacterSeasonEvidenceManifestV2): ScoringSelectedRunRow[] {
  return [...document.slots]
    .sort((a, b) => {
      const dungeon = a.dungeonSlug.localeCompare(b.dungeonSlug);
      return dungeon !== 0 ? dungeon : a.slotIndex - b.slotIndex;
    })
    .map((s: EvidenceSlotV2) => ({
      slotId: s.slotId,
      dungeonSlug: s.dungeonSlug,
      slotIndex: s.slotIndex,
      reportCode: s.identity?.reportCode ?? null,
      fightId: s.identity?.fightId ?? null,
      reportRevision: s.identity?.reportRevision ?? null,
      participantActorId: s.actorId ?? null,
      keyLevel: typeof s.keyLevel === "number" ? s.keyLevel : null,
    }));
}

export async function loadCanonicalEvidenceManifest(input: {
  prisma: PrismaClient;
  characterId: string;
  seasonId: string;
}): Promise<{
  rowId: string;
  contentHash: string;
  document: CharacterSeasonEvidenceManifestV2;
} | null> {
  const row = await input.prisma.evidenceManifest.findFirst({
    where: { characterId: input.characterId, seasonId: input.seasonId },
    orderBy: { frozenAt: "desc" },
  });
  if (!row?.document || typeof row.document !== "object") return null;
  const document = row.document as CharacterSeasonEvidenceManifestV2;
  if (!Array.isArray(document.slots)) return null;
  return { rowId: row.id, contentHash: row.contentHash, document };
}

export async function loadBoostAssessmentEvidence(input: {
  prisma: PrismaClient;
  characterId: string;
  seasonId: string;
}): Promise<{
  runs: BoostRunInput[];
  seasonHighKeyContext: SeasonHighKeyContext;
  dungeonContexts: BoostDungeonContext[];
  regionCode: string | null;
  lineage: {
    manifestId: string | null;
    manifestContentHash: string | null;
    source: "character_score_selected_runs" | "evidence_manifest_replay" | "missing";
    canonicalSlots: BoostLineageSlot[];
    boostSlots: BoostLineageSlot[];
    setsEqual: boolean;
  };
}> {
  const character = await input.prisma.character.findUnique({
    where: { id: input.characterId },
    include: { region: { select: { code: true } } },
  });
  const regionCode = character?.region?.code ?? null;

  const score = await input.prisma.characterScore.findFirst({
    where: { characterId: input.characterId, seasonId: input.seasonId },
    orderBy: { calculatedAt: "desc" },
  });
  const details = asRecord(score?.dimensionDetails);
  const persistedContext = asRecord(details?.scoreContext) as AppliedScoreContext | null;
  const persistedSelection = asRecord(details?.canonicalScoringRunSelection);
  const eightCount = Array.isArray(persistedSelection?.selectedRuns)
    ? persistedSelection!.selectedRuns.length
    : 0;
  const seasonHighKeyContext = seasonHighKeyContextFromApplied(persistedContext, eightCount);

  let source: "character_score_selected_runs" | "evidence_manifest_replay" | "missing" =
    "character_score_selected_runs";
  let selected = parseSelectedRuns(score?.selectedRuns);
  let manifestId: string | null = null;
  let manifestContentHash: string | null = null;

  if (selected.length === 0) {
    const frozen = await loadCanonicalEvidenceManifest(input);
    if (frozen) {
      source = "evidence_manifest_replay";
      selected = slotsFromManifest(frozen.document);
      manifestId = frozen.rowId;
      manifestContentHash = frozen.contentHash;
    } else {
      source = "missing";
      return {
        runs: [],
        seasonHighKeyContext: {
          ...seasonHighKeyContext,
          available: false,
          missingReason: "INSUFFICIENT_SAMPLE",
        },
        dungeonContexts: [],
        regionCode,
        lineage: {
          manifestId: null,
          manifestContentHash: null,
          source,
          canonicalSlots: [],
          boostSlots: [],
          setsEqual: true,
        },
      };
    }
  }

  const runs: BoostRunInput[] = [];
  const canonicalSlots: BoostLineageSlot[] = [];
  const boostSlots: BoostLineageSlot[] = [];

  for (const slot of selected) {
    const lineage: BoostLineageSlot = {
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      dungeonSlug: slot.dungeonSlug,
      reportCode: slot.reportCode,
      fightId: slot.fightId,
      reportRevision: slot.reportRevision,
      participantActorId: slot.participantActorId,
      keyLevel: slot.keyLevel,
      rawRunId: null,
      rankingSnapshotId: null,
      missingClass: null,
    };
    canonicalSlots.push({ ...lineage });
    const ranking = await attachRankingSnapshot({
      prisma: input.prisma,
      reportCode: slot.reportCode,
      fightId: slot.fightId,
      reportRevision: slot.reportRevision,
      subjectActorId: slot.participantActorId,
    });
    lineage.rawRunId = ranking.rawRunId;
    lineage.rankingSnapshotId = ranking.rankingSnapshotId;
    lineage.missingClass = ranking.missingReason
      ? (ranking.missingReason as BoostSlotMissingClass)
      : null;
    boostSlots.push({ ...lineage });

    let deathCount: number | null = null;
    let survivalAvailable = false;
    if (ranking.rawRunId && input.prisma.characterRunDigest?.findMany) {
      const digests = await input.prisma.characterRunDigest.findMany({
        where: { rawRunId: ranking.rawRunId, characterId: input.characterId },
      });
      const survival = digests[0]?.survival;
      if (survival && typeof survival === "object" && Array.isArray((survival as { deaths?: unknown }).deaths)) {
        deathCount = (survival as { deaths: unknown[] }).deaths.length;
        survivalAvailable = true;
      }
    }

    runs.push({
      runId: slot.slotId,
      seasonId: input.seasonId,
      dungeonSlug: slot.dungeonSlug,
      dungeonName: slot.dungeonSlug,
      keyLevel: 0,
      timed: true,
      completedAt: null,
      subjectKeyParse: ranking.subjectKeyParse,
      parsePercentile: ranking.subjectKeyParse,
      parseSemantic: ranking.subjectKeyParse != null ? "BRACKET_PERCENT" : "UNAVAILABLE",
      deathCount,
      survivalAvailable,
      alignmentStatus: ranking.subjectKeyParse != null ? "ALIGNED" : "MISSING",
      evidenceSource: ranking.subjectKeyParse != null ? "WCL_FIGHT_RANKING_BRACKET_PERCENT" : null,
      missingReason: ranking.missingReason,
      peerKeyParses: ranking.peerKeyParses,
      rankingSnapshotId: ranking.rankingSnapshotId,
      rankingSnapshotContentHash: ranking.rankingSnapshotContentHash,
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      wclCode: slot.reportCode,
      wclFightId: slot.fightId,
      participants: [],
    });
  }

  const dungeonContexts = await loadBoostDungeonContexts({
    prisma: input.prisma,
    characterId: input.characterId,
    seasonId: input.seasonId,
  });
  const canonicalKeys = canonicalSlots.map((s) => s.slotId).sort();
  const boostKeys = boostSlots.map((s) => s.slotId).sort();
  return {
    runs,
    seasonHighKeyContext,
    dungeonContexts,
    regionCode,
    lineage: {
      manifestId,
      manifestContentHash,
      source,
      canonicalSlots,
      boostSlots,
      setsEqual: canonicalKeys.length === boostKeys.length && canonicalKeys.every((id, i) => id === boostKeys[i]),
    },
  };
}
