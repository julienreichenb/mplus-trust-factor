import type { Character, CharacterSnapshot, EquipmentSnapshot, GameClass, GameSpecialization } from "@mplus/database";
import type {
  AnalyzedRunSummary,
  CharacterProfileResponse,
  EquipmentSummary,
  ProfileEntitlements,
  ProfileWarning,
  SeasonSummary,
  TalentSummary,
} from "@mplus/contracts";
import type { AppEnv } from "@mplus/config";
import type { MythicRunWithRelations } from "@mplus/worker";
import { mapRunSummary } from "./mappers.js";

export interface CharacterEnrichmentInput {
  character: Character & {
    gameClass?: GameClass | null;
    activeSpec?: GameSpecialization | null;
  };
  latestSnapshot?: (CharacterSnapshot & { equipment?: EquipmentSnapshot | null }) | null;
  latestRun: MythicRunWithRelations | null;
  highestRun: MythicRunWithRelations | null;
  runCount: number;
  seasonSlug: string | null;
  env: AppEnv;
}

function runToSummary(
  run: MythicRunWithRelations,
  kind: AnalyzedRunSummary["kind"],
): AnalyzedRunSummary {
  const summary = mapRunSummary(run);
  return {
    runId: summary.runId,
    kind,
    dungeonName: run.dungeon.name ?? run.dungeon.slug,
    dungeonSlug: summary.dungeonSlug,
    keyLevel: summary.keyLevel,
    completedAt: summary.completedAt,
    timed: summary.timed,
    performanceSummary: `Key +${summary.keyLevel} ${summary.timed ? "timed" : "depleted"}`,
    coverageRatio: 1,
  };
}

function buildWarnings(score: CharacterProfileResponse["score"]): ProfileWarning[] {
  const warnings: ProfileWarning[] = [];
  if (score && score.confidence < 0.35) {
    warnings.push({
      code: "INSUFFICIENT_DATA",
      message: "Data incomplete — confidence is reduced toward neutral.",
      severity: "WARN",
    });
  }
  if (score?.redFlags.some((f) => f.key === "logs_hidden")) {
    warnings.push({
      code: "LOGS_HIDDEN",
      message: "Detailed logs are hidden or incomplete.",
      severity: "WARN",
    });
  }
  if (score?.redFlags.some((f) => f.key === "boost_suspected")) {
    warnings.push({
      code: "AUTHENTICITY",
      message: "Authenticity signals are probabilistic, not proof of boosting.",
      severity: "INFO",
    });
  }
  return warnings;
}

function buildEntitlements(env: AppEnv): ProfileEntitlements {
  return {
    detailsUnlocked: env.PUBLIC_DETAILS_ALL,
    runsUnlocked: env.PUBLIC_DETAILS_ALL,
    compareExpanded: env.PUBLIC_DETAILS_ALL,
  };
}

/** Maps persisted character/run/snapshot rows into profile enrichment fields. */
export function buildProfileEnrichments(input: CharacterEnrichmentInput): Pick<
  CharacterProfileResponse,
  | "classSlug"
  | "specSlug"
  | "role"
  | "itemLevel"
  | "lastAnalyzedRun"
  | "highestAnalyzedRun"
  | "equipment"
  | "talents"
  | "seasonSummary"
  | "entitlements"
  | "warnings"
  | "raiderIoUsed"
> {
  const { character, latestSnapshot, latestRun, highestRun, runCount, seasonSlug, env } = input;
  const bothSame = latestRun && highestRun && latestRun.id === highestRun.id;

  let lastAnalyzedRun: AnalyzedRunSummary | null = null;
  let highestAnalyzedRun: AnalyzedRunSummary | null = null;
  if (latestRun) {
    lastAnalyzedRun = runToSummary(latestRun, bothSame ? "BOTH" : "LATEST");
  }
  if (highestRun) {
    highestAnalyzedRun = runToSummary(highestRun, bothSame ? "BOTH" : "HIGHEST");
  }

  let equipment: EquipmentSummary | null = null;
  if (latestSnapshot?.equipment) {
    const eq = latestSnapshot.equipment;
    const keyItemsRaw = eq.keyItems;
    const keyItems = Array.isArray(keyItemsRaw)
      ? (keyItemsRaw as Array<{ slot: string; name: string; itemLevel: number | null }>)
      : [];
    equipment = {
      averageItemLevel: eq.averageItemLevel,
      equippedItemLevel: eq.equippedItemLevel,
      keyItems,
    };
  }

  const talents: TalentSummary | null = character.activeSpec
    ? {
        specializationSlug: character.activeSpec.slug,
        loadoutCode: null,
        summary: null,
      }
    : null;

  const seasonSummary: SeasonSummary | null = seasonSlug
    ? {
        seasonSlug,
        runCount,
        mythicRating: latestSnapshot?.mythicRating ?? null,
        priorSeasonRating: null,
      }
    : null;

  return {
    classSlug: character.gameClass?.slug ?? null,
    specSlug: character.activeSpec?.slug ?? null,
    role: character.role ?? null,
    itemLevel: latestSnapshot?.itemLevelEquipped ?? null,
    lastAnalyzedRun,
    highestAnalyzedRun,
    equipment,
    talents,
    seasonSummary,
    entitlements: buildEntitlements(env),
    warnings: [],
    raiderIoUsed: Boolean(character.raiderioProfileUrl),
  };
}

export function applyProfileWarnings(
  enrichments: ReturnType<typeof buildProfileEnrichments>,
  score: CharacterProfileResponse["score"],
): ReturnType<typeof buildProfileEnrichments> {
  return { ...enrichments, warnings: buildWarnings(score) };
}
