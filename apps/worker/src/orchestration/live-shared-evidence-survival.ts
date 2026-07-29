/**
 * Live refresh helper: ingest shared evidence once, analyze Survival without a second event fetch.
 */
import type { AbilityCatalog } from "@mplus/abilities";
import type { WclGraphQlClient } from "@mplus/provider-warcraftlogs";
import {
  ingestSharedEvidenceBundle,
  buildSurvivalAnalysisFromSharedEvidence,
  sharedEvidenceBundleHasSurvivalDatasets,
  type SharedEvidenceStore,
  type WclRunEvidenceBundle,
} from "@mplus/provider-warcraftlogs";

export interface LiveSharedEvidenceSurvivalInput {
  client: WclGraphQlClient | null;
  store: SharedEvidenceStore;
  identity: { region: "EU" | "US" | "KR" | "TW"; realmSlug: string; name: string };
  characterId: string;
  reportCode: string;
  fightId: number;
  reportRevision: number | null;
  dungeonSlug: string;
  keyLevel: number | null;
  playerActorId: number;
  ownedPetActorIds: number[];
  fightStartTime: number;
  fightEndTime: number;
  encounterId?: number | null;
  encounterName?: string | null;
  timed?: boolean | null;
  completed?: boolean | null;
  score?: number | null;
  catalog: AbilityCatalog;
  classSlug: string | null;
  specSlug: string | null;
  forceRefetch?: boolean;
  region?: string;
  /** Fetch datasets for both Survival and future Utility in one pass. */
  includeUtilityDatasets?: boolean;
}

export interface LiveSharedEvidenceSurvivalResult {
  bundle: WclRunEvidenceBundle;
  summary: ReturnType<typeof buildSurvivalAnalysisFromSharedEvidence>["summary"];
  requestCount: number;
  detailedWclEventCalls: number;
  maxHpFailureReason: string | null;
  fromSharedEvidence: true;
  reusedPersistedEvidence: boolean;
}

export async function analyzeSurvivalViaSharedEvidence(
  input: LiveSharedEvidenceSurvivalInput,
): Promise<LiveSharedEvidenceSurvivalResult> {
  const consumers: Array<"survival" | "utility"> = input.includeUtilityDatasets
    ? ["survival", "utility"]
    : ["survival"];

  const bundle = await ingestSharedEvidenceBundle({
    client: input.client,
    store: input.store,
    reportCode: input.reportCode,
    reportRevision: input.reportRevision,
    fightId: input.fightId,
    playerActorId: input.playerActorId,
    ownedPetActorIds: input.ownedPetActorIds,
    dungeonSlug: input.dungeonSlug,
    startTime: input.fightStartTime,
    endTime: input.fightEndTime,
    consumers,
    forceRefetch: input.forceRefetch === true,
    region: input.region ?? input.identity.region,
  });

  if (!sharedEvidenceBundleHasSurvivalDatasets(bundle)) {
    throw new Error(
      `Shared evidence incomplete for Survival: missing=${bundle.completeness.missing.join(",")}`,
    );
  }

  const analyzed = buildSurvivalAnalysisFromSharedEvidence({
    bundle,
    characterId: input.characterId,
    identity: input.identity,
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision ?? "unknown",
    dungeonSlug: input.dungeonSlug,
    keyLevel: input.keyLevel,
    playerActorId: input.playerActorId,
    ownedPetActorIds: input.ownedPetActorIds,
    fightStartTime: input.fightStartTime,
    fightEndTime: input.fightEndTime,
    encounterId: input.encounterId,
    encounterName: input.encounterName,
    timed: input.timed,
    completed: input.completed,
    score: input.score,
    catalog: input.catalog,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });

  return {
    bundle,
    summary: analyzed.summary,
    requestCount: analyzed.requestCount,
    detailedWclEventCalls: analyzed.detailedWclEventCalls,
    maxHpFailureReason: analyzed.maxHpFailureReason,
    fromSharedEvidence: true,
    reusedPersistedEvidence: bundle.accounting.providerCalls === 0,
  };
}
