/**
 * Map the in-memory scoring orchestration result onto BoostRunInput.
 * Does not select runs. Slots come from the same CharacterSeasonEvidenceManifestV2
 * already produced by orchestrateScoringRuns.
 */
import type { AppliedScoreContext, CharacterSeasonEvidenceManifestV2 } from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import type {
  BoostDungeonContext,
  BoostRunInput,
  SeasonHighKeyContext,
  ScoringRunSelection,
} from "@mplus/scoring";
import type { RunOrchestrationResult } from "../orchestration/scoring/run-orchestration/orchestrator.js";
import { attachRankingSnapshot } from "./attach-ranking-snapshot.js";
import { loadBoostDungeonContexts } from "./load-dungeon-contexts.js";
import { seasonHighKeyContextFromApplied } from "./season-high-key-context.js";

export function scoringSourceFightsFromManifest(manifest: CharacterSeasonEvidenceManifestV2) {
  return [...manifest.slots]
    .sort((a, b) => {
      const dungeon = a.dungeonSlug.localeCompare(b.dungeonSlug);
      return dungeon !== 0 ? dungeon : a.slotIndex - b.slotIndex;
    })
    .map((slot) => ({
      slotId: slot.slotId,
      dungeonSlug: slot.dungeonSlug,
      slotIndex: slot.slotIndex,
      state: slot.state,
      timed: slot.timed ?? null,
      keyLevel: slot.keyLevel ?? null,
      reportCode: slot.identity?.reportCode ?? null,
      fightId: slot.identity?.fightId ?? null,
      reportRevision: slot.identity?.reportRevision ?? null,
      participantActorId: slot.actorId ?? null,
    }));
}

export async function buildBoostRunsFromOrchestration(input: {
  prisma: PrismaClient;
  seasonId: string;
  characterId: string;
  manifest: CharacterSeasonEvidenceManifestV2;
  characterDigests: RunOrchestrationResult["characterDigests"];
  appliedContext: AppliedScoreContext;
  canonicalRunSelection?: ScoringRunSelection | null;
}): Promise<{
  runs: BoostRunInput[];
  seasonHighKeyContext: SeasonHighKeyContext;
  scoringSourceFights: ReturnType<typeof scoringSourceFightsFromManifest>;
  dungeonContexts: BoostDungeonContext[];
}> {
  const digestBySlot = new Map(input.characterDigests.map((row) => [row.slotId, row]));
  const scoringSourceFights = scoringSourceFightsFromManifest(input.manifest);
  const runs: BoostRunInput[] = [];

  for (const slot of input.manifest.slots) {
    const digestRow = digestBySlot.get(slot.slotId);
    const digest = digestRow?.digest;
    const identity = slot.identity;
    const subjectActorId = digest?.participantActorId ?? slot.actorId ?? null;
    let missingReason: BoostRunInput["missingReason"] =
      slot.state !== "SELECTED" || identity == null ? "CANONICAL_SLOT_MISSING" : null;
    const ranking = identity
      ? await attachRankingSnapshot({
          prisma: input.prisma,
          reportCode: identity.reportCode,
          fightId: identity.fightId,
          reportRevision: identity.reportRevision,
          subjectActorId,
        })
      : null;
    if (ranking?.missingReason && missingReason == null) {
      missingReason = ranking.missingReason;
    }
    const deaths = digest?.survival.deaths;
    runs.push({
      runId: slot.slotId,
      seasonId: input.seasonId,
      dungeonSlug: slot.dungeonSlug,
      dungeonName: slot.dungeonSlug,
      keyLevel: slot.keyLevel ?? digest?.keyLevel ?? 0,
      timed: slot.timed ?? digest?.timed ?? false,
      scoreValue: slot.runScore ?? digest?.runScore ?? null,
      completedAt: slot.completedAt ?? digest?.completedAt ?? null,
      subjectKeyParse: ranking?.subjectKeyParse ?? null,
      parsePercentile: ranking?.subjectKeyParse ?? null,
      parseSemantic: ranking?.subjectKeyParse != null ? "BRACKET_PERCENT" : "UNAVAILABLE",
      deathCount: Array.isArray(deaths) ? deaths.length : null,
      survivalAvailable: Array.isArray(deaths),
      usedForMedian: false,
      alignmentStatus:
        ranking?.subjectKeyParse != null
          ? "ALIGNED"
          : ranking?.missingReason === "AMBIGUOUS_WCL_ALIGNMENT"
            ? "AMBIGUOUS"
            : "MISSING",
      evidenceSource:
        ranking?.subjectKeyParse != null ? "WCL_FIGHT_RANKING_BRACKET_PERCENT" : null,
      missingReason,
      peerKeyParses: ranking?.peerKeyParses ?? [],
      rankingSnapshotId: ranking?.rankingSnapshotId ?? null,
      rankingSnapshotContentHash: ranking?.rankingSnapshotContentHash ?? null,
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      wclCode: identity?.reportCode ?? null,
      wclFightId: identity?.fightId ?? null,
      participants: digest
        ? [
            {
              characterId: digest.characterId ?? input.characterId,
              providerCharacterKey: digest.characterId,
              regionCode: digest.regionCode ?? "",
              realmSlug: digest.realmSlug ?? "",
              displayName: digest.characterName,
              isTargetCharacter: true,
              role: digest.role,
            },
          ]
        : [],
    });
  }

  return {
    runs,
    seasonHighKeyContext: seasonHighKeyContextFromApplied(
      input.appliedContext,
      input.canonicalRunSelection?.selectedRuns.length ?? 0,
    ),
    scoringSourceFights,
    dungeonContexts: await loadBoostDungeonContexts({
      prisma: input.prisma,
      characterId: input.characterId,
      seasonId: input.seasonId,
    }),
  };
}
