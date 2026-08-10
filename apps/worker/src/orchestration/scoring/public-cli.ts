/**
 * Public Scoring V2 operator surface.
 *
 * Supported modes only:
 *   scoring:canary  — consolidated shadow pipeline (discover + live + replay)
 *   scoring:replay  — provider-free reconstruction
 *   scoring:doctor  — provider-free diagnostics (no mutation)
 */
import { loadEnv } from "@mplus/config";
import type { EvidenceRole } from "@mplus/contracts";
import {
  createProductionCanaryDependencies,
  assertOperatorRepositoryMode,
  resolveCanaryCharacterIdentity,
} from "./canary/canary-deps.js";
import {
  assertSeasonCatalogOk,
  resolveCanarySeasonCatalog,
} from "./canary/canary-season.js";
import {
  parseCanaryCliArgs,
  runCanaryDiscoverCommand,
  evaluateCanaryLiveGates,
  resolveZoneForCanaryCommand,
  type CanaryCliArgs,
} from "./canary/cli.js";
import { runScoringCanaryReplay } from "./canary/canary-replay.js";
import { runTargetDigestDiagnostic } from "./canary/canary-target-digest-diagnostic.js";
import { diagnoseSeasonCatalog } from "./canary/canary-diagnose.js";
import { loadCompatibleFrozenManifest } from "./canary/canary-live.js";
import { runConsolidatedShadowPipeline } from "./pipeline/consolidated-shadow-pipeline.js";
import { isDiscoveryExecuteArmed } from "./canary/canary-discovery-gates.js";

export type PublicMode = "canary" | "replay" | "doctor";

export function parsePublicCliArgs(argv: string[]): {
  mode: PublicMode;
  args: CanaryCliArgs;
  confirmExecute: boolean;
} {
  const raw = [...argv];
  let mode: PublicMode = "canary";
  if (raw[0] === "canary" || raw[0] === "replay" || raw[0] === "doctor") {
    mode = raw.shift() as PublicMode;
  } else if (
    raw[0] === "live" ||
    raw[0] === "discover" ||
    raw[0] === "preflight" ||
    raw[0] === "ranking-hydrate" ||
    raw[0] === "repair-package" ||
    raw[0] === "reconcile-revisions" ||
    raw[0] === "rate-snapshot" ||
    raw[0] === "diagnose-target-digests" ||
    raw[0] === "diagnose-catalog" ||
    raw[0] === "repair-catalog"
  ) {
    throw Object.assign(
      new Error(
        `deprecated_operator_command:${raw[0]}: use scoring:canary | scoring:replay | scoring:doctor`,
      ),
      { code: "DEPRECATED_OPERATOR_COMMAND", command: raw[0] },
    );
  }

  // Map public mode onto legacy parser flags.
  const legacyMode =
    mode === "canary" ? "live" : mode === "replay" ? "replay" : "diagnose-catalog";
  const parsed = parseCanaryCliArgs([legacyMode, ...raw]);
  const confirmExecute =
    parsed.confirmLive ||
    parsed.confirmDiscovery ||
    process.env.SCORING_CANARY_EXECUTE === "true" ||
    raw.includes("--confirm-execute");

  return { mode, args: { ...parsed, mode: legacyMode }, confirmExecute };
}

async function runPublicCanary(input: {
  args: CanaryCliArgs;
  confirmExecute: boolean;
}): Promise<void> {
  const env = loadEnv();
  assertOperatorRepositoryMode("PRODUCTION");
  const characterIdentity = {
    region: input.args.region.toUpperCase() as "EU" | "US" | "KR" | "TW" | "CN",
    realmSlug: input.args.realm,
    name: input.args.character,
  };
  const deps = await createProductionCanaryDependencies({
    env,
    identity: characterIdentity,
  });
  try {
    const season = await resolveCanarySeasonCatalog({
      prisma: deps.container.prisma,
      regionId: deps.character.regionId,
      regionCode: input.args.region,
    });
    assertSeasonCatalogOk(season);
    const zone = resolveZoneForCanaryCommand(input.args);
    const classSpec = await resolveCanaryCharacterIdentity({
      prisma: deps.container.prisma,
      characterId: deps.characterResolution.characterId,
      fallbackRole: (deps.character.role ?? "DPS") as EvidenceRole,
    });

    const gate = evaluateCanaryLiveGates({
      env,
      confirmLive: input.confirmExecute,
      characterCount: 1,
    });
    if (!gate.allowed && input.confirmExecute) {
      // Still allow pipeline to diagnose when live gates fail mid-flight.
    }

    const { reportPath, report } = await runConsolidatedShadowPipeline({
      env,
      prisma: deps.container.prisma,
      container: deps.container,
      characterId: deps.characterResolution.characterId,
      characterName: input.args.character,
      region: input.args.region,
      realm: input.args.realm,
      classSlug: classSpec.classSlug,
      specSlug: classSpec.specSlug,
      role: classSpec.role,
      season,
      characterResolution: deps.characterResolution,
      zone,
      confirmExecute: input.confirmExecute,
      outputDir: input.args.outputDir ?? undefined,
      providerFreeOnly: false,
      discoverStage: async () => {
        if (!isDiscoveryExecuteArmed(process.env) && !input.args.confirmDiscovery) {
          // Arm discovery via confirm-execute for consolidated canary.
          process.env.SCORING_CANARY_DISCOVERY_EXECUTE = "true";
        }
        const discovered = await runCanaryDiscoverCommand({
          ...input.args,
          mode: "discover",
          confirmDiscovery: true,
        });
        return {
          manifestId: discovered.report.manifestId,
          selectedSlotCount: discovered.report.selectedSlotCount,
          providerCalls: discovered.report.graphqlRequestCount ?? 0,
          reused: false,
        };
      },
    });

    console.log(
      JSON.stringify(
        {
          reportPath,
          outcome: report.outcome,
          stages: report.stages.map((s) => ({
            name: s.name,
            status: s.status,
          })),
          providerCalls: report.providerCalls,
          publicationEnabled: report.publicationEnabled,
          publicScorePointerMutated: report.publicScorePointerMutated,
        },
        null,
        2,
      ),
    );
  } finally {
    await deps.container.prisma.$disconnect().catch(() => undefined);
  }
}

async function runPublicReplay(args: CanaryCliArgs): Promise<void> {
  const env = loadEnv();
  const characterIdentity = {
    region: args.region.toUpperCase() as "EU" | "US" | "KR" | "TW" | "CN",
    realmSlug: args.realm,
    name: args.character,
  };
  const deps = await createProductionCanaryDependencies({
    env,
    identity: characterIdentity,
  });
  try {
    const season = await resolveCanarySeasonCatalog({
      prisma: deps.container.prisma,
      regionId: deps.character.regionId,
      regionCode: args.region,
    });
    assertSeasonCatalogOk(season);
    const classSpec = await resolveCanaryCharacterIdentity({
      prisma: deps.container.prisma,
      characterId: deps.characterResolution.characterId,
      fallbackRole: (deps.character.role ?? "DPS") as EvidenceRole,
    });
    const { reportPath, report } = await runScoringCanaryReplay({
      env,
      prisma: deps.container.prisma,
      container: deps.container,
      characterId: deps.characterResolution.characterId,
      characterName: args.character,
      region: args.region,
      realm: args.realm,
      classSlug: classSpec.classSlug,
      specSlug: classSpec.specSlug,
      role: classSpec.role,
      season,
      repositoryMode: "PRODUCTION",
      outputDir: args.outputDir ?? undefined,
    });
    console.log(
      JSON.stringify(
        {
          reportPath,
          providerCalls: report.providerCalls,
          packagesReused: report.packagesReused,
          packageAcquisitions: report.packageAcquisitions,
          scoringAuthority: report.scoringAuthority,
          explainabilityFingerprint: report.explainabilityFingerprint,
          dimensions: {
            performance: {
              score: report.dimensions.performance.score,
              confidence: report.dimensions.performance.confidence,
              strengths: report.dimensions.performance.strengths,
              weaknesses: report.dimensions.performance.weaknesses,
            },
            survival: {
              score: report.dimensions.survival.score,
              confidence: report.dimensions.survival.confidence,
              strengths: report.dimensions.survival.strengths,
              weaknesses: report.dimensions.survival.weaknesses,
            },
            utility: {
              score: report.dimensions.utility.score,
              confidence: report.dimensions.utility.confidence,
              strengths: report.dimensions.utility.strengths,
              weaknesses: report.dimensions.utility.weaknesses,
            },
            experience: {
              score: report.dimensions.experience.score,
              confidence: report.dimensions.experience.confidence,
              strengths: report.dimensions.experience.strengths,
              weaknesses: report.dimensions.experience.weaknesses,
            },
          },
          composite: report.composite,
          publicationEnabled: report.publicationEnabled,
        },
        null,
        2,
      ),
    );
  } finally {
    await deps.container.prisma.$disconnect().catch(() => undefined);
  }
}

async function runPublicDoctor(args: CanaryCliArgs): Promise<void> {
  const env = loadEnv();
  const identity = {
    region: args.region.toUpperCase() as "EU" | "US" | "KR" | "TW" | "CN",
    realmSlug: args.realm,
    name: args.character,
  };
  const deps = await createProductionCanaryDependencies({ env, identity });
  try {
    const season = await resolveCanarySeasonCatalog({
      prisma: deps.container.prisma,
      regionId: deps.character.regionId,
      regionCode: args.region,
    });
    const catalog = await diagnoseSeasonCatalog(deps.container.prisma);
    const frozen =
      season.seasonId && season.dungeonPoolHash
        ? await loadCompatibleFrozenManifest({
            prisma: deps.container.prisma,
            characterId: deps.characterResolution.characterId,
            seasonId: season.seasonId,
            expectedDungeonSlugs: season.activeDungeonSlugs,
            dungeonPoolHash: season.dungeonPoolHash,
          })
        : null;
    let digestDiag = null;
    if (frozen) {
      const { report } = await runTargetDigestDiagnostic({
        prisma: deps.container.prisma,
        manifestId: frozen.rowId,
        characterId: deps.characterResolution.characterId,
        characterName: args.character,
        region: args.region,
        realm: args.realm,
        outputDir: args.outputDir ?? undefined,
      });
      digestDiag = {
        targetDigestCountByStableIdentity:
          report.targetDigestCountByStableIdentity,
        problemClassSummary: report.problemClassSummary,
        performance: report.performance,
      };
    }
    console.log(
      JSON.stringify(
        {
          mode: "doctor",
          mutation: false,
          providerCalls: 0,
          season: {
            validationStatus: season.validationStatus,
            seasonId: season.seasonId,
            dungeonPoolHash: season.dungeonPoolHash,
          },
          catalog: {
            seasonCount: catalog.seasons.length,
            staleManifestsRequireInvalidation:
              catalog.staleManifestsRequireInvalidation,
          },
          manifestId: frozen?.rowId ?? null,
          digestDiagnostic: digestDiag,
        },
        null,
        2,
      ),
    );
  } finally {
    await deps.container.prisma.$disconnect().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const { mode, args, confirmExecute } = parsePublicCliArgs(
    process.argv.slice(2),
  );
  if (mode === "canary") {
    await runPublicCanary({ args, confirmExecute });
    return;
  }
  if (mode === "replay") {
    await runPublicReplay(args);
    return;
  }
  await runPublicDoctor(args);
}

const isDirect =
  process.argv[1]?.includes("public-cli") ||
  process.argv[1]?.includes("scoring-public");
if (isDirect) {
  main().catch((err) => {
    console.error(
      JSON.stringify(
        {
          code:
            err && typeof err === "object" && "code" in err
              ? (err as { code: unknown }).code
              : "scoring_PUBLIC_CLI_FAILED",
          message: err instanceof Error ? err.message : String(err),
          reasons:
            err && typeof err === "object" && "reasons" in err
              ? (err as { reasons: unknown }).reasons
              : undefined,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  });
}
