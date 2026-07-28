import type {
  Character,
  CharacterSnapshot,
  EquipmentSnapshot,
  GameClass,
  GameSpecialization,
  TalentSnapshot,
} from "@mplus/database";
import type {
  AnalyzedRunSummary,
  CharacterMediaDTO,
  CharacterProfileResponse,
  CharacterProviderStateDTO,
  EquipmentItemDTO,
  EquipmentSummary,
  PerformanceSummaryDTO,
  SurvivalSummaryPublicDTO,
  ProfileEntitlements,
  ProfileWarning,
  RefreshContractStaleReason,
  RefreshContractVersions,
  ScoringRunSelection,
  SeasonSummary,
  SelectedRunSummaryDTO,
  TalentSummary,
  WclDataState,
  WclVisibilityState,
} from "@mplus/contracts";
import {
  isScoreSnapshotModelStale,
  readRefreshContractFromExplanation,
  refreshContractStaleReasons,
} from "@mplus/contracts";
import type { AppEnv } from "@mplus/config";
import type { MythicRunWithRelations } from "@mplus/worker";
import { mapRunSummary } from "./mappers.js";

export interface CharacterEnrichmentInput {
  character: Character & {
    gameClass?: GameClass | null;
    activeSpec?: GameSpecialization | null;
    realm?: { slug: string; name: string } | null;
  };
  latestSnapshot?:
    | (CharacterSnapshot & {
        equipment?: EquipmentSnapshot | null;
        talents?: TalentSnapshot[];
      })
    | null;
  latestRun: MythicRunWithRelations | null;
  highestRun: MythicRunWithRelations | null;
  runCount: number;
  seasonSlug: string | null;
  seasonName?: string | null;
  wclVisibility: WclVisibilityState | null;
  wclDataState?: WclDataState | null;
  providerStates?: CharacterProviderStateDTO[];
  selectedRunCoverage?: number | null;
  runCoverageById?: Record<string, number | null>;
  performanceSummary?: PerformanceSummaryDTO | null;
  survivalSummary?: SurvivalSummaryPublicDTO | null;
  scoringRunSelection?: ScoringRunSelection | null;
  selectedRunCount?: number | null;
  detailedRunCount?: number | null;
  runNamesById?: Record<string, { dungeonName: string }>;
  freshness?: number | null;
  sourceDisagreements?: CharacterProfileResponse["sourceDisagreements"];
  scoreObservationProviders?: string[];
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
): number | null {
  const analyzed = runCoverageById?.[runId];
  return typeof analyzed === "number" && Number.isFinite(analyzed) ? analyzed : null;
}

/** Build selectedRuns DTO from the canonical persisted scoringRunSelection. */
export function mapSelectedRunsFromCanonicalSelection(
  scoringRunSelection: ScoringRunSelection | null | undefined,
  runCoverageById?: Record<string, number | null>,
  runNamesById?: Record<string, { dungeonName: string }>,
  performanceSummary?: PerformanceSummaryDTO | null,
): SelectedRunSummaryDTO[] {
  if (!scoringRunSelection) return [];

  return scoringRunSelection.selectedRuns.map((entry) => {
    const runId = entry.canonicalRunId;
    const coverage = runId != null ? coverageForRun(runId, runCoverageById) : null;
    const perfDungeon = performanceSummary?.currentSeason.dungeons.find(
      (d) => d.dungeonSlug === entry.dungeonSlug,
    );
    const parsePercentile =
      perfDungeon?.bestParsePercentile ?? perfDungeon?.bestRun?.parsePercentile ?? null;

    return {
      runId,
      dungeonSlug: entry.dungeonSlug,
      dungeonName:
        runNamesById?.[runId ?? ""]?.dungeonName ?? entry.dungeonName ?? entry.dungeonSlug,
      keyLevel: entry.keyLevel,
      completedAt: entry.completedAt,
      timed: entry.timed ?? false,
      wclReportMatched: entry.wclReportMatched,
      wclCoverageRatio: entry.coverageRatio ?? coverage,
      selectionReason: entry.selectionReason,
      parsePercentile,
      hasDetailedAnalysis: coverage != null && coverage > 0,
    };
  });
}

function sanitizeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("https://")) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function mapEquipmentItem(raw: unknown): EquipmentItemDTO | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const slot = typeof item.slot === "string" ? item.slot : null;
  if (!slot) return null;
  const itemId = typeof item.itemId === "number" && item.itemId > 0 ? item.itemId : null;
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : null;
  const itemLevel =
    typeof item.itemLevel === "number" && Number.isFinite(item.itemLevel) && item.itemLevel > 0
      ? item.itemLevel
      : null;
  const quality = typeof item.quality === "string" ? item.quality : null;
  const iconUrl = sanitizeHttpsUrl(item.iconUrl ?? item.icon);
  const enchantments = Array.isArray(item.enchantments)
    ? item.enchantments.filter((e): e is string => typeof e === "string" && e.trim().length > 0)
    : typeof item.enchantment === "string" && item.enchantment.trim()
      ? [item.enchantment.trim()]
      : [];
  const gems = Array.isArray(item.gems)
    ? item.gems
        .map((g) => {
          if (!g || typeof g !== "object") return null;
          const gem = g as { name?: unknown; itemId?: unknown };
          if (typeof gem.name !== "string" || !gem.name.trim()) return null;
          return {
            name: gem.name.trim(),
            itemId: typeof gem.itemId === "number" ? gem.itemId : null,
          };
        })
        .filter((g): g is { name: string; itemId: number | null } => g != null)
    : [];

  return { slot, itemId, name, itemLevel, quality, iconUrl, enchantments, gems };
}

/** Map persisted equipment JSON into the public DTO. Never invent item level 0. */
export function mapEquipmentSummary(equipment: EquipmentSnapshot | null | undefined): EquipmentSummary | null {
  if (!equipment) return null;
  const rawItems = Array.isArray(equipment.items) ? equipment.items : [];
  const rawKeyItems = Array.isArray(equipment.keyItems) ? equipment.keyItems : [];
  const items = (rawItems.length > 0 ? rawItems : rawKeyItems)
    .map(mapEquipmentItem)
    .filter((i): i is EquipmentItemDTO => i != null);
  const keyItems = rawKeyItems
    .map(mapEquipmentItem)
    .filter((i): i is EquipmentItemDTO => i != null);

  const average =
    equipment.averageItemLevel != null && equipment.averageItemLevel > 0
      ? equipment.averageItemLevel
      : null;
  const equipped =
    equipment.equippedItemLevel != null && equipment.equippedItemLevel > 0
      ? equipment.equippedItemLevel
      : null;

  if (items.length === 0 && average == null && equipped == null) {
    // Preserve an explicit empty equipment summary when a snapshot row exists.
    return {
      averageItemLevel: null,
      equippedItemLevel: null,
      items: [],
      keyItems: [],
    };
  }

  return {
    averageItemLevel: average,
    equippedItemLevel: equipped,
    items,
    keyItems: keyItems.length > 0 ? keyItems : items.filter((i) => /trinket|finger|neck/i.test(i.slot)),
  };
}

export function mapCharacterMedia(rawSummary: unknown): CharacterMediaDTO | null {
  if (!rawSummary || typeof rawSummary !== "object") return null;
  const media = (rawSummary as { media?: unknown }).media;
  if (!media || typeof media !== "object") return null;
  const m = media as Record<string, unknown>;
  const avatarUrl = sanitizeHttpsUrl(m.avatarUrl);
  const insetUrl = sanitizeHttpsUrl(m.insetUrl);
  const mainRawUrl = sanitizeHttpsUrl(m.mainRawUrl ?? m.mainUrl);
  if (!avatarUrl && !insetUrl && !mainRawUrl) return null;
  return { avatarUrl, insetUrl, mainRawUrl };
}

export function mapTalentSummary(
  character: CharacterEnrichmentInput["character"],
  snapshot: CharacterEnrichmentInput["latestSnapshot"],
): TalentSummary | null {
  const talentRow = snapshot?.talents?.[0] ?? null;
  const specializationSlug =
    character.activeSpec?.slug ??
    (talentRow
      ? ((talentRow.talents as { activeSpecialization?: { name?: string } } | null)?.activeSpecialization
          ?.name ?? null)
      : null);

  if (!talentRow && !specializationSlug) return null;

  const loadoutCode = talentRow?.loadoutCode ?? null;
  return {
    specializationSlug: specializationSlug ?? character.activeSpec?.slug ?? null,
    loadoutCode,
    summary: loadoutCode
      ? "Blizzard talent loadout available"
      : specializationSlug
        ? "Specialization known; detailed loadout unavailable"
        : null,
    loadoutName: null,
    selectedTalents: null,
    sourceProvider: talentRow ? "blizzard" : null,
    fetchedAt: snapshot?.capturedAt?.toISOString?.() ?? null,
  };
}

function buildWarnings(
  score: CharacterProfileResponse["score"],
  wclVisibility: WclVisibilityState | null,
  wclDataState: WclDataState | null,
  providerStates?: CharacterProviderStateDTO[] | null,
): ProfileWarning[] {
  const warnings: ProfileWarning[] = [];
  if (score?.grade === "U" || (score && score.confidence < 0.35)) {
    warnings.push({
      code: "INSUFFICIENT_DATA",
      message: "Data incomplete — confidence is too low for a reliable grade (UNRATED).",
      severity: "WARN",
    });
  }
  const scoreCalculatedAtMs = score?.calculatedAt ? Date.parse(score.calculatedAt) : NaN;
  if (Number.isFinite(scoreCalculatedAtMs) && providerStates && providerStates.length > 0) {
    const newerProvider = providerStates.find((state) => {
      if (!state.fetchedAt) return false;
      const fetchedMs = Date.parse(state.fetchedAt);
      return Number.isFinite(fetchedMs) && fetchedMs > scoreCalculatedAtMs + 1_000;
    });
    if (newerProvider) {
      warnings.push({
        code: "SCORE_STALE_VS_PROVIDERS",
        message:
          "Provider data is newer than the published score snapshot — score may not reflect the latest Performance refresh.",
        severity: "WARN",
      });
    }
  }
  if (score?.redFlags.some((f) => f.key === "logs_hidden") || wclVisibility === "HIDDEN") {
    warnings.push({
      code: "LOGS_HIDDEN",
      message: "Detailed logs are explicitly hidden.",
      severity: "WARN",
    });
  } else if (wclDataState === "NO_PUBLIC_LOGS" || score?.redFlags.some((f) => f.key === "no_public_logs")) {
    warnings.push({
      code: "NO_PUBLIC_LOGS",
      message: "No public Warcraft Logs reports were found.",
      severity: "WARN",
    });
  } else if (wclDataState === "UNAVAILABLE" || score?.redFlags.some((f) => f.key === "wcl_unavailable")) {
    warnings.push({
      code: "WCL_UNAVAILABLE",
      message: "Warcraft Logs was unavailable during enrichment.",
      severity: "INFO",
    });
  } else if (wclDataState === "RATE_LIMITED" || score?.redFlags.some((f) => f.key === "wcl_rate_limited")) {
    warnings.push({
      code: "WCL_RATE_LIMITED",
      message: "Warcraft Logs enrichment was rate-limited.",
      severity: "INFO",
    });
  } else if (
    wclDataState === "NO_MATCHED_RUN" ||
    score?.redFlags.some((f) => f.key === "no_matched_run")
  ) {
    warnings.push({
      code: "NO_MATCHED_RUN",
      message: "Public profile — no combat logs matched to selected runs.",
      severity: "INFO",
    });
  } else if (wclDataState === "RANKINGS_ONLY") {
    warnings.push({
      code: "RANKINGS_ONLY",
      message: "Public rankings contributed; detailed combat analysis unavailable.",
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

/** Canonical public provider keys used by the SPA provenance panel. */
export function toPublicProviderKey(provider: string): string {
  const normalized = provider.trim().toLowerCase().replace(/[_-]+/g, "");
  if (normalized === "blizzard") return "BLIZZARD";
  if (normalized === "raiderio") return "RAIDER_IO";
  if (normalized === "warcraftlogs") return "WARCRAFT_LOGS";
  return provider.toUpperCase();
}

export function providerContributedToScore(
  provider: string,
  observationProviders: string[] | undefined,
): boolean {
  if (!observationProviders || observationProviders.length === 0) return false;
  const key = toPublicProviderKey(provider);
  return observationProviders.some((p) => toPublicProviderKey(p) === key);
}

/** Maps persisted character/run/snapshot rows into profile enrichment fields. */
export function buildProfileEnrichments(input: CharacterEnrichmentInput): Pick<
  CharacterProfileResponse,
  | "classSlug"
  | "specSlug"
  | "role"
  | "faction"
  | "level"
  | "profileUrl"
  | "realmName"
  | "itemLevel"
  | "freshness"
  | "lastAnalyzedRun"
  | "highestAnalyzedRun"
  | "scoringRunSelection"
  | "equipment"
  | "talents"
  | "media"
  | "seasonSummary"
  | "performanceSummary"
  | "survivalSummary"
  | "selectedRuns"
  | "selectedRunCount"
  | "detailedRunCount"
  | "entitlements"
  | "warnings"
  | "raiderIoUsed"
  | "wclVisibility"
  | "wclDataState"
  | "providerStates"
  | "sourceDisagreements"
> {
  const {
    character,
    latestSnapshot,
    latestRun,
    highestRun,
    runCount,
    seasonSlug,
    seasonName,
    wclVisibility,
    wclDataState,
    providerStates,
    selectedRunCoverage,
    runCoverageById,
    performanceSummary = null,
    survivalSummary = null,
    scoringRunSelection = null,
    selectedRunCount = null,
    detailedRunCount = null,
    runNamesById = {},
    freshness = null,
    sourceDisagreements,
    scoreObservationProviders,
    env,
  } = input;
  const bothSame = latestRun && highestRun && latestRun.id === highestRun.id;

  let lastAnalyzedRun: AnalyzedRunSummary | null = null;
  let highestAnalyzedRun: AnalyzedRunSummary | null = null;
  if (latestRun) {
    lastAnalyzedRun = runToSummary(
      latestRun,
      bothSame ? "BOTH" : "LATEST",
      coverageForRun(latestRun.id, runCoverageById) ?? 0,
    );
  }
  if (highestRun) {
    highestAnalyzedRun = runToSummary(
      highestRun,
      bothSame ? "BOTH" : "HIGHEST",
      coverageForRun(highestRun.id, runCoverageById) ?? 0,
    );
  }

  const equipment = mapEquipmentSummary(latestSnapshot?.equipment ?? null);
  const talents = mapTalentSummary(character, latestSnapshot);
  const media = mapCharacterMedia(latestSnapshot?.rawSummary);

  const seasonSummary: SeasonSummary | null = seasonSlug
    ? {
        seasonSlug,
        seasonName: seasonName ?? null,
        runCount,
        mythicRating: latestSnapshot?.mythicRating ?? null,
        priorSeasonRating: null,
        latestActivityAt:
          latestRun?.completedAt instanceof Date
            ? latestRun.completedAt.toISOString()
            : typeof latestRun?.completedAt === "string"
              ? latestRun.completedAt
              : null,
      }
    : null;

  const rawIlvl = latestSnapshot?.itemLevelEquipped ?? null;
  const itemLevel = rawIlvl != null && rawIlvl > 0 ? rawIlvl : null;

  const enrichedProviderStates = (providerStates ?? []).map((state) => ({
    ...state,
    contributedToScore: providerContributedToScore(state.provider, scoreObservationProviders),
    sourceUrl:
      state.provider === "raiderio" ? (character.raiderioProfileUrl ?? null) : (state.sourceUrl ?? null),
  }));

  const canonicalScoringRunSelection = scoringRunSelection;

  const selectedRuns = mapSelectedRunsFromCanonicalSelection(
    canonicalScoringRunSelection,
    runCoverageById,
    runNamesById,
    performanceSummary,
  );

  return {
    classSlug: character.gameClass?.slug ?? null,
    specSlug: character.activeSpec?.slug ?? null,
    role: character.role ?? null,
    faction: character.faction ?? null,
    level: character.level != null && character.level > 0 ? character.level : null,
    profileUrl: character.profileUrl ?? null,
    realmName: character.realm?.name ?? null,
    itemLevel,
    freshness,
    lastAnalyzedRun,
    highestAnalyzedRun,
    scoringRunSelection: canonicalScoringRunSelection,
    equipment,
    talents,
    media,
    seasonSummary,
    performanceSummary: performanceSummary ?? null,
    survivalSummary: survivalSummary ?? null,
    selectedRuns,
    selectedRunCount: selectedRunCount ?? canonicalScoringRunSelection?.selectedRuns.length ?? selectedRuns.length,
    detailedRunCount:
      detailedRunCount ?? selectedRuns.filter((r) => r.hasDetailedAnalysis).length,
    entitlements: buildEntitlements(env),
    warnings: [],
    raiderIoUsed: Boolean(character.raiderioProfileUrl),
    wclVisibility,
    wclDataState: wclDataState ?? null,
    providerStates: enrichedProviderStates,
    sourceDisagreements: sourceDisagreements ?? [],
  };
}

export function applyProfileWarnings(
  enrichments: ReturnType<typeof buildProfileEnrichments>,
  score: CharacterProfileResponse["score"],
): ReturnType<typeof buildProfileEnrichments> {
  return {
    ...enrichments,
    warnings: buildWarnings(
      score,
      enrichments.wclVisibility ?? null,
      enrichments.wclDataState ?? null,
      enrichments.providerStates,
    ),
  };
}

/** True when any provider fetch is meaningfully newer than the published score. */
export function isScoreStaleVersusProviders(
  scoreCalculatedAt: string | null | undefined,
  providerStates: Array<{ fetchedAt?: string | null }> | null | undefined,
): boolean {
  if (!scoreCalculatedAt || !providerStates?.length) return false;
  const scoreMs = Date.parse(scoreCalculatedAt);
  if (!Number.isFinite(scoreMs)) return false;
  return providerStates.some((state) => {
    if (!state.fetchedAt) return false;
    const fetchedMs = Date.parse(state.fetchedAt);
    return Number.isFinite(fetchedMs) && fetchedMs > scoreMs + 1_000;
  });
}

/** Reasons the published snapshot is incompatible with the active refresh contract / model. */
export function scoreSnapshotContractStaleReasons(input: {
  score: { modelKey: string; modelVersion: number; explanation?: unknown } | null | undefined;
  activeModel: { key: string; version: number };
  activeContract: RefreshContractVersions;
}): RefreshContractStaleReason[] {
  if (!input.score) return ["CONTRACT_MISSING"];
  const reasons: RefreshContractStaleReason[] = [];
  if (
    isScoreSnapshotModelStale(
      { modelKey: input.score.modelKey, modelVersion: input.score.modelVersion },
      input.activeModel,
    )
  ) {
    reasons.push("SCORING_MODEL_CHANGED");
  }
  const stored = readRefreshContractFromExplanation(input.score.explanation);
  for (const reason of refreshContractStaleReasons(stored, input.activeContract)) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return reasons;
}

export function appendRefreshContractWarnings(
  warnings: ProfileWarning[] | undefined,
  reasons: RefreshContractStaleReason[],
): ProfileWarning[] {
  const next = [...(warnings ?? [])];
  for (const reason of reasons) {
    if (next.some((w) => w.code === reason)) continue;
    next.push({
      code: reason,
      message: `Published score is stale versus the active refresh contract (${reason}).`,
      severity: "WARN",
    });
  }
  return next;
}
