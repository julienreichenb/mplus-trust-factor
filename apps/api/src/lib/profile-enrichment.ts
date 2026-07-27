import type { Character, CharacterSnapshot, EquipmentSnapshot, GameClass, GameSpecialization } from "@mplus/database";
import type {
  AnalyzedRunSummary,
  CharacterProfileResponse,
  CharacterProviderStateDTO,
  EquipmentSummary,
  ProfileEntitlements,
  ProfileWarning,
  SeasonSummary,
  TalentSummary,
  WclVisibilityState,
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
  wclVisibility: WclVisibilityState | null;
  providerStates?: CharacterProviderStateDTO[];
  /** Selected-run combat coverage (0–1), aligned with score context.selectedRunCoverage. */
  selectedRunCoverage?: number | null;
  runCoverageById?: Record<string, number | null>;
  env: AppEnv;
}

function runToSummary(
  run: MythicRunWithRelations,
  kind: AnalyzedRunSummary["kind"],
  coverageRatio: number,
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
    coverageRatio,
  };
}

function coverageForRun(
  runId: string,
  runCoverageById: Record<string, number | null> | undefined,
  selectedRunCoverage: number | null | undefined,
): number {
  const analyzed = runCoverageById?.[runId];
  if (typeof analyzed === "number") return analyzed;
  // Never claim full coverage when no WCL combat facts were analyzed.
  if (selectedRunCoverage == null) return 0;
  return selectedRunCoverage;
}

function buildWarnings(
  score: CharacterProfileResponse["score"],
  wclVisibility: WclVisibilityState | null,
): ProfileWarning[] {
  const warnings: ProfileWarning[] = [];
  if (score?.grade === "U" || (score && score.confidence < 0.35)) {
    warnings.push({
      code: "INSUFFICIENT_DATA",
      message: "Data incomplete — confidence is too low for a reliable grade (UNRATED).",
      severity: "WARN",
    });
  }
  if (score?.redFlags.some((f) => f.key === "logs_hidden") || wclVisibility === "HIDDEN") {
    warnings.push({
      code: "LOGS_HIDDEN",
      message: "Detailed logs are explicitly hidden.",
      severity: "WARN",
    });
  } else if (wclVisibility === "NO_PUBLIC_LOGS" || score?.redFlags.some((f) => f.key === "no_public_logs")) {
    warnings.push({
      code: "NO_PUBLIC_LOGS",
      message: "No public Warcraft Logs reports were found.",
      severity: "WARN",
    });
  } else if (wclVisibility === "UNAVAILABLE" || score?.redFlags.some((f) => f.key === "wcl_unavailable")) {
    warnings.push({
      code: "WCL_UNAVAILABLE",
      message: "Warcraft Logs was unavailable during enrichment.",
      severity: "INFO",
    });
  } else if (wclVisibility === "RATE_LIMITED" || score?.redFlags.some((f) => f.key === "wcl_rate_limited")) {
    warnings.push({
      code: "WCL_RATE_LIMITED",
      message: "Warcraft Logs enrichment was rate-limited.",
      severity: "INFO",
    });
  } else if (
    wclVisibility === "NO_MATCHED_RUN" ||
    score?.redFlags.some((f) => f.key === "no_matched_run")
  ) {
    warnings.push({
      code: "NO_MATCHED_RUN",
      message: "Public logs exist but none matched the selected runs.",
      severity: "INFO",
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
  | "wclVisibility"
  | "providerStates"
> {
  const {
    character,
    latestSnapshot,
    latestRun,
    highestRun,
    runCount,
    seasonSlug,
    wclVisibility,
    providerStates,
    selectedRunCoverage,
    runCoverageById,
    env,
  } = input;
  const bothSame = latestRun && highestRun && latestRun.id === highestRun.id;

  let lastAnalyzedRun: AnalyzedRunSummary | null = null;
  let highestAnalyzedRun: AnalyzedRunSummary | null = null;
  if (latestRun) {
    lastAnalyzedRun = runToSummary(
      latestRun,
      bothSame ? "BOTH" : "LATEST",
      coverageForRun(latestRun.id, runCoverageById, selectedRunCoverage),
    );
  }
  if (highestRun) {
    highestAnalyzedRun = runToSummary(
      highestRun,
      bothSame ? "BOTH" : "HIGHEST",
      coverageForRun(highestRun.id, runCoverageById, selectedRunCoverage),
    );
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
        // Unique MythicRun.canonicalFingerprint count (not provider source refs).
        runCount,
        mythicRating: latestSnapshot?.mythicRating ?? null,
        priorSeasonRating: null,
      }
    : null;

  // Preserve null item level — never coerce unavailable values to zero.
  const rawIlvl = latestSnapshot?.itemLevelEquipped ?? null;
  const itemLevel = rawIlvl != null && rawIlvl > 0 ? rawIlvl : null;

  return {
    classSlug: character.gameClass?.slug ?? null,
    specSlug: character.activeSpec?.slug ?? null,
    role: character.role ?? null,
    itemLevel,
    lastAnalyzedRun,
    highestAnalyzedRun,
    equipment,
    talents,
    seasonSummary,
    entitlements: buildEntitlements(env),
    warnings: [],
    raiderIoUsed: Boolean(character.raiderioProfileUrl),
    wclVisibility,
    providerStates: providerStates ?? [],
  };
}

export function applyProfileWarnings(
  enrichments: ReturnType<typeof buildProfileEnrichments>,
  score: CharacterProfileResponse["score"],
): ReturnType<typeof buildProfileEnrichments> {
  return {
    ...enrichments,
    warnings: buildWarnings(score, enrichments.wclVisibility ?? null),
  };
}
