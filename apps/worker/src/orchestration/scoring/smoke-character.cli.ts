/**
 * Real-character product smoke: identity → refresh-pipeline → scoreCharacter → CharacterScore.
 *
 * Usage (from repo root):
 *   pnpm scoring:smoke:character
 *   pnpm scoring:smoke:character -- --region EU --realm archimonde --character Wallidrixe
 *   pnpm scoring:smoke:character -- --replay
 *   pnpm scoring:smoke:character -- --score-only
 *   pnpm scoring:smoke:character -- --score-only --runs
 *
 * Identity (CLI overrides env):
 *   SCORING_SMOKE_REGION / SCORING_SMOKE_REALM / SCORING_SMOKE_CHARACTER
 *
 * Does not print secrets. Exits non-zero when refresh or CharacterScore persistence fails.
 */
import { loadEnv, resetEnvCache } from "@mplus/config";
import type { RegionCode, ScoreSnapshotDTO } from "@mplus/contracts";
import { createWorkerContainer } from "../../container.js";
import { runRefreshPipeline } from "../refresh-pipeline.js";
import { runRecalculateScore } from "../recalculate-score.js";
import { requireVerifiedSeasonAuthority } from "../season-authority.js";
import { ensureRegion } from "../../persistence/realm-repository.js";
import { resolveActiveRefreshContract } from "../build-refresh-contract.js";
import { SCORING_VERSION } from "./score-character.js";
import {
  formatSmokeRunsTableText,
  loadSmokeRunsTable,
} from "./smoke-runs-table.js";

type SmokeIdentity = {
  region: RegionCode;
  realmSlug: string;
  name: string;
};

function parseArgs(argv: string[]): {
  identity: Partial<SmokeIdentity>;
  replay: boolean;
  scoreOnly: boolean;
  forceRefresh: boolean;
  runs: boolean;
} {
  let region = "";
  let realmSlug = "";
  let name = "";
  let replay = false;
  let scoreOnly = false;
  let forceRefresh = true;
  let runs = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = argv[i + 1];
    if (a === "--region" && next) {
      region = next;
      i++;
    } else if (a === "--realm" && next) {
      realmSlug = next;
      i++;
    } else if ((a === "--character" || a === "--name") && next) {
      name = next;
      i++;
    } else if (a === "--replay") {
      replay = true;
    } else if (a === "--score-only") {
      scoreOnly = true;
    } else if (a === "--no-force") {
      forceRefresh = false;
    } else if (a === "--runs") {
      runs = true;
    }
  }
  return {
    identity: {
      region: region ? (region.toUpperCase() as RegionCode) : undefined,
      realmSlug: realmSlug ? realmSlug.toLowerCase() : undefined,
      name: name || undefined,
    },
    replay,
    scoreOnly,
    forceRefresh,
    runs,
  };
}

function resolveIdentity(partial: Partial<SmokeIdentity>): SmokeIdentity {
  const region = (
    partial.region ||
    process.env.SCORING_SMOKE_REGION ||
    ""
  ).toUpperCase() as RegionCode;
  const realmSlug = (
    partial.realmSlug ||
    process.env.SCORING_SMOKE_REALM ||
    ""
  ).toLowerCase();
  const name = partial.name || process.env.SCORING_SMOKE_CHARACTER || "";

  const missing: string[] = [];
  if (!region) missing.push("SCORING_SMOKE_REGION (or --region)");
  if (!realmSlug) missing.push("SCORING_SMOKE_REALM (or --realm)");
  if (!name) missing.push("SCORING_SMOKE_CHARACTER (or --character)");
  if (missing.length > 0) {
    throw Object.assign(
      new Error(`Missing real-character smoke identity: ${missing.join(", ")}`),
      { code: "SMOKE_IDENTITY_MISSING", missing },
    );
  }
  if (!["EU", "US", "KR", "TW", "CN"].includes(region)) {
    throw new Error(`Invalid region for smoke: ${region}`);
  }
  return { region, realmSlug, name };
}

function dimFromSnapshot(
  score: ScoreSnapshotDTO | null,
  dimension: string,
): { score: number | null; reason: string | null } {
  const row = score?.dimensions?.find((d) => d.dimension === dimension);
  return { score: row?.score ?? null, reason: row?.reason ?? null };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const identity = resolveIdentity(parsed.identity);
  const env = loadEnv();

  if (!env.SCORING_ENABLED) {
    console.error("REFUSED: SCORING_ENABLED must be true for product scoring smoke");
    process.exit(2);
  }

  const container = createWorkerContainer(env);
  const { prisma, repositories, providers, logger } = container;

  try {
    const regionRow = await ensureRegion(prisma, identity.region);
    const authority = await requireVerifiedSeasonAuthority(
      { prisma, blizzard: providers.blizzard, logger },
      regionRow.code,
      regionRow.id,
      { allowProviderSync: true, correlationId: null },
    );

    const activeModel =
      (await repositories.score.getActiveModel()) ?? {
        key: env.ACTIVE_SCORE_MODEL_KEY,
        version: env.ACTIVE_SCORE_MODEL_VERSION,
      };

    const { contract, hash } = resolveActiveRefreshContract({
      scoringModelKey: activeModel.key,
      scoringModelVersion: activeModel.version,
      activeSeasonId: authority.slug,
      providerMode: env.PROVIDER_MODE,
      env: process.env,
    });

    const existing = await repositories.character.findByIdentity({
      region: identity.region,
      realmSlug: identity.realmSlug,
      name: identity.name,
    });

    let scoreDto: ScoreSnapshotDTO | null = null;
    let providerCallsReported: number | null = null;
    let mode: "refresh" | "replay" | "score-only" = "refresh";

    if (parsed.replay || parsed.scoreOnly) {
      mode = parsed.replay ? "replay" : "score-only";
      if (!existing) {
        throw new Error(`Character must exist in DB for --${mode}`);
      }
      const season = await prisma.season.findFirst({
        where: { regionId: existing.regionId, slug: authority.slug },
        orderBy: { updatedAt: "desc" },
      });
      if (!season) {
        throw new Error(`Season ${authority.slug} not found for character region`);
      }

      if (parsed.replay) {
        // Provider-free container: deny live calls and make WCL methods throw.
        process.env.ALLOW_LIVE_PROVIDER_CALLS = "false";
        resetEnvCache();
        const replayEnv = loadEnv();
        const replayContainer = createWorkerContainer(replayEnv, { prisma });
        const wcl = replayContainer.providers.warcraftlogs as unknown as Record<
          string,
          unknown
        >;
        for (const key of Object.keys(wcl)) {
          if (typeof wcl[key] === "function") {
            wcl[key] = () => {
              throw new Error(`provider_forbidden:${key}`);
            };
          }
        }

        scoreDto = await runRecalculateScore(replayContainer, {
          characterId: existing.id,
          seasonId: season.id,
          scoreModelKey: activeModel.key,
          scoreModelVersion: activeModel.version,
          requestedAt: new Date().toISOString(),
        });
        providerCallsReported = 0;
      } else {
        // Warm recalculation from persisted digests/raw (may still use live for
        // cache miss only; expected near-zero when evidence is warm).
        scoreDto = await runRecalculateScore(container, {
          characterId: existing.id,
          seasonId: season.id,
          scoreModelKey: activeModel.key,
          scoreModelVersion: activeModel.version,
          requestedAt: new Date().toISOString(),
        });
        const explanation = scoreDto?.explanation as
          | { providerCalls?: number }
          | null
          | undefined;
        providerCallsReported =
          typeof explanation?.providerCalls === "number"
            ? explanation.providerCalls
            : null;
      }
    } else {
      if (!env.ALLOW_LIVE_PROVIDER_CALLS) {
        console.error("REFUSED: ALLOW_LIVE_PROVIDER_CALLS must be true for cold/warm smoke");
        process.exit(2);
      }
      const result = await runRefreshPipeline(container, {
        region: identity.region,
        realmSlug: identity.realmSlug,
        name: identity.name,
        characterId: existing?.id,
        priority: "normal",
        forceRefresh: parsed.forceRefresh,
        requestedAt: new Date().toISOString(),
        refreshContractHash: hash,
        scoringModelKey: activeModel.key,
        scoringModelVersion: activeModel.version,
        authoritativeSeasonId: authority.blizzardSeasonId,
        authoritativeSeasonSlug: authority.slug,
        authoritySource: authority.authoritySource,
        triggerSource: "SYSTEM",
      });
      scoreDto = result.score;
      const explanation = result.score?.explanation as
        | { providerCalls?: number }
        | null
        | undefined;
      providerCallsReported =
        typeof explanation?.providerCalls === "number"
          ? explanation.providerCalls
          : result.sharedEvidenceDetailedEventCalls ?? null;
    }

    const resolved =
      existing ??
      (await repositories.character.findByIdentity({
        region: identity.region,
        realmSlug: identity.realmSlug,
        name: identity.name,
      }));

    if (!resolved) {
      throw new Error("Character not found after refresh");
    }

    const persisted = await prisma.characterScore.findFirst({
      where: {
        characterId: resolved.id,
        scoringVersion: SCORING_VERSION,
      },
      orderBy: { calculatedAt: "desc" },
    });

    const digestCount = await prisma.characterRunDigest.count({
      where: { characterId: resolved.id },
    });
    const digestRawIds = await prisma.characterRunDigest.findMany({
      where: { characterId: resolved.id },
      select: { rawRunId: true },
      distinct: ["rawRunId"],
    });
    const aggregate = await prisma.characterPerformanceAggregate.findFirst({
      where: {
        characterId: resolved.id,
        zoneId: contract.zoneId ?? undefined,
      },
      orderBy: { fetchedAt: "desc" },
    });

    const details = (persisted?.dimensionDetails ?? null) as Record<
      string,
      unknown
    > | null;
    const selectedRuns = Array.isArray(persisted?.selectedRuns)
      ? (persisted!.selectedRuns as unknown[])
      : [];

    const perfSnap = dimFromSnapshot(scoreDto, "PERFORMANCE");
    const utilSnap = dimFromSnapshot(scoreDto, "UTILITY");
    const survSnap = dimFromSnapshot(scoreDto, "SURVIVAL");

    const summary = {
      ok: Boolean(persisted),
      mode,
      character: `${identity.region}/${identity.realmSlug}/${identity.name}`,
      characterId: resolved.id,
      season: authority.slug,
      blizzardSeasonId: authority.blizzardSeasonId,
      zoneId: contract.zoneId,
      partition: contract.partition ?? null,
      scoringVersion: persisted?.scoringVersion ?? null,
      selectedRuns: selectedRuns.length,
      rawFightsPersisted: digestRawIds.length,
      targetDigestsPersisted: digestCount,
      profileAggregate: aggregate ? "available" : "unavailable",
      performance: persisted?.performance ?? null,
      performanceReason: perfSnap.reason,
      utility: persisted?.utility ?? null,
      utilityReason: utilSnap.reason,
      survival: persisted?.survival ?? null,
      survivalReason: survSnap.reason,
      experience: persisted?.experience ?? null,
      composite: persisted?.composite ?? null,
      characterScoreId: persisted?.id ?? null,
      providerCalls: providerCallsReported,
      calculatorVersions: {
        performance:
          (details?.performance as { calculatorVersion?: string } | null)
            ?.calculatorVersion ?? null,
        utility:
          (details?.utility as { algorithmVersion?: string } | null)
            ?.algorithmVersion ?? null,
        survival:
          (details?.survival as { algorithmVersion?: string } | null)
            ?.algorithmVersion ?? null,
      },
      blocked: details?.blocked ?? null,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!persisted) {
      console.error("FAIL: CharacterScore not persisted");
      process.exit(1);
    }
    if (persisted.scoringVersion !== SCORING_VERSION) {
      console.error(
        `FAIL: unexpected scoringVersion ${persisted.scoringVersion} (expected ${SCORING_VERSION})`,
      );
      process.exit(1);
    }
    for (const [label, value] of [
      ["performance", persisted.performance],
      ["utility", persisted.utility],
      ["survival", persisted.survival],
    ] as const) {
      if (value != null && (!Number.isFinite(value) || value < 0 || value > 100)) {
        console.error(`FAIL: ${label} out of bounds: ${value}`);
        process.exit(1);
      }
    }
    if (parsed.replay && providerCallsReported !== 0) {
      console.error(`FAIL: replay provider calls expected 0, got ${providerCallsReported}`);
      process.exit(1);
    }

    if (parsed.runs) {
      const runsTable = await loadSmokeRunsTable({
        prisma,
        characterId: resolved.id,
        seasonId: persisted.seasonId,
        selectedRuns: persisted.selectedRuns,
      });
      console.log(formatSmokeRunsTableText(runsTable));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (error && typeof error === "object" && "missing" in error) {
    console.error(JSON.stringify({ missing: (error as { missing: string[] }).missing }));
  }
  process.exit(1);
});
