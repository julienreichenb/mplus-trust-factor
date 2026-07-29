/**
 * Production-safe controlled shared-evidence load for a single character.
 * Batch rateLimitData before/after cost accounting; second pass must make zero event calls.
 * Utility remains disabled — no scoring/publication.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LiveWarcraftLogsProvider } from "../live/live-provider.js";
import {
  formatPointsConsumed,
  WclBatchCostTracker,
} from "./wcl-batch-cost-accounting.js";
import { fetchSharedEventDataset, fingerprintPayload } from "./wcl-run-evidence.js";
import {
  HOSTILE_CAST_FILTER_EXPRESSION,
  WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  buildSharedEvidenceCompatibilityKey,
  type WclRunEvidenceDataset,
} from "./wcl-run-evidence-types.js";
import {
  InMemorySharedEvidenceStore,
  ingestSharedEvidenceBundle,
} from "./shared-evidence-ingest.js";
import { sharedSelectionFromUtilityNormalizedRuns } from "./shared-run-selection.js";
import { evaluateRateBudget, parseRateLimitSnapshot } from "../rate/rate-budget.js";

interface NormalizedRunLite {
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  playerActorId: number | null;
  petActorIds?: number[];
  durationMs?: number;
}

function parseArgs(argv: string[]): {
  region: string;
  realm: string;
  name: string;
  outputRoot: string;
  maxRuns: number;
  forceRefetch: boolean;
  simulateInsufficientQuota: boolean;
} {
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      bools.add(key);
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return {
    region: flags.region ?? "EU",
    realm: flags.realm ?? "Archimonde",
    name: flags.name ?? "Wallidrixe",
    outputRoot:
      flags["output-root"]?.trim() ||
      join(process.cwd(), "raw-artifacts", "wcl-probe-utility"),
    maxRuns: Number(flags["max-runs"] ?? 2),
    forceRefetch: bools.has("force-refetch"),
    simulateInsufficientQuota: bools.has("simulate-insufficient-quota"),
  };
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function datasetKey(
  reportCode: string,
  fightId: number,
  actorId: number | null,
  dataset: "HostileCasts" | "Deaths",
  endTime: number | null,
): string {
  return buildSharedEvidenceCompatibilityKey({
    reportCode,
    reportRevision: null,
    fightId,
    actorId,
    dataset,
    startTime: null,
    endTime,
    filterExpression: dataset === "HostileCasts" ? "hostile-npc-casts" : null,
    providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
    payloadFingerprint: null,
  });
}

export async function runSharedEvidenceCharacterLoad(options: {
  region: string;
  realm: string;
  name: string;
  outputRoot: string;
  maxRuns: number;
  forceRefetch: boolean;
  simulateInsufficientQuota: boolean;
}): Promise<{ reportPath: string }> {
  const label = `${options.region}/${options.realm}/${options.name}`;
  const dir = join(
    options.outputRoot,
    `${options.region.toLowerCase()}-${options.realm.toLowerCase()}-${options.name.toLowerCase()}`,
  );
  const outDir = join(options.outputRoot, "shared-evidence-load");
  await mkdir(outDir, { recursive: true });

  if (options.simulateInsufficientQuota) {
    const snapshot = parseRateLimitSnapshot({
      limitPerHour: 3600,
      pointsSpentThisHour: 3585,
    });
    const decision = evaluateRateBudget(snapshot, {
      warnPercent: 70,
      deferPercent: 80,
      stopPercent: 90,
    });
    const estimatedCost = 12 + 6 + 1; // HostileCasts + Deaths + preflight
    const remaining = snapshot.pointsRemaining;
    const safetyReserve = Math.max(remaining * 0.1, 1);
    const allowed = remaining >= estimatedCost + safetyReserve && decision.action === "OK";
    const report = {
      character: label,
      simulated: true,
      estimatedCost,
      pointsRemaining: remaining,
      safetyReserve,
      budgetAction: decision.action,
      allowed,
      reason: allowed ? "OK" : "DEFERRED_RATE_LIMIT",
      publishedScorePreserved: true,
      utilityEnabled: false,
      note: "Insufficient quota defers shared-evidence load; published score unchanged.",
    };
    const reportPath = join(outDir, `${options.name.toLowerCase()}-insufficient-quota.json`);
    await writeJson(reportPath, report);
    console.log(JSON.stringify(report, null, 2));
    if (allowed) throw new Error("expected insufficient quota simulation to defer");
    return { reportPath };
  }

  if (process.env.ALLOW_LIVE_PROVIDER_CALLS !== "true") {
    throw new Error("ALLOW_LIVE_PROVIDER_CALLS=true is required");
  }
  const clientId = process.env.WCL_CLIENT_ID ?? "";
  const clientSecret = process.env.WCL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("WCL_CLIENT_ID and WCL_CLIENT_SECRET are required");
  }

  const normalizedPath = join(dir, "07-utility-normalized-runs.json");
  if (!existsSync(normalizedPath)) {
    throw new Error(`Missing normalized runs at ${normalizedPath}`);
  }
  const runs = (
    JSON.parse(await readFile(normalizedPath, "utf8")) as NormalizedRunLite[]
  ).slice(0, options.maxRuns);

  const selection = sharedSelectionFromUtilityNormalizedRuns(
    label,
    "active-season",
    runs,
    { scoringModelScope: "shared-evidence-production" },
  );
  await writeJson(join(dir, "00-shared-run-selection.json"), selection);

  const provider = new LiveWarcraftLogsProvider({
    env: {
      WCL_CLIENT_ID: clientId,
      WCL_CLIENT_SECRET: clientSecret,
      WCL_PUBLIC_GRAPHQL_URL:
        process.env.WCL_PUBLIC_GRAPHQL_URL ?? "https://www.warcraftlogs.com/api/v2/client",
      WCL_TOKEN_URL:
        process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token",
      WCL_RATE_WARN_PERCENT: Number(process.env.WCL_RATE_WARN_PERCENT ?? 70),
      WCL_RATE_DEFER_PERCENT: Number(process.env.WCL_RATE_DEFER_PERCENT ?? 80),
      WCL_RATE_STOP_PERCENT: Number(process.env.WCL_RATE_STOP_PERCENT ?? 90),
      WCL_CHARACTER_TTL_SECONDS: Number(process.env.WCL_CHARACTER_TTL_SECONDS ?? 43_200),
    },
    processEnv: process.env,
  });
  const client = provider.getGraphQlClient();
  const store = new InMemorySharedEvidenceStore();
  const tracker = new WclBatchCostTracker();
  await tracker.begin(client, options.region);

  const fetchAndPersist = async (run: NormalizedRunLite) => {
    let eventCalls = 0;
    const hostile = await fetchSharedEventDataset({
      client,
      reportCode: run.reportCode,
      fightId: run.fightId,
      dataset: "HostileCasts",
      hostilityType: "Enemies",
      filterExpression: HOSTILE_CAST_FILTER_EXPRESSION,
      region: options.region,
      maxPages: 6,
    });
    for (const c of hostile.dataset.requestCostUnits) tracker.recordRequest(c, 1);
    eventCalls += hostile.wclRequests;

    const deaths = await fetchSharedEventDataset({
      client,
      reportCode: run.reportCode,
      fightId: run.fightId,
      dataset: "Deaths",
      region: options.region,
      maxPages: 4,
    });
    for (const c of deaths.dataset.requestCostUnits) tracker.recordRequest(c, 1);
    eventCalls += deaths.wclRequests;

    await store.saveDataset(
      datasetKey(
        run.reportCode,
        run.fightId,
        run.playerActorId,
        "HostileCasts",
        run.durationMs ?? null,
      ),
      hostile.dataset,
      {
        reportCode: run.reportCode,
        reportRevision: null,
        fightId: run.fightId,
        dataset: "HostileCasts",
      },
    );
    await store.saveDataset(
      datasetKey(run.reportCode, run.fightId, run.playerActorId, "Deaths", run.durationMs ?? null),
      deaths.dataset,
      {
        reportCode: run.reportCode,
        reportRevision: null,
        fightId: run.fightId,
        dataset: "Deaths",
      },
    );

    // Append-only file artifacts (do not touch Utility score files).
    const runId = `${run.reportCode}:${run.fightId}`;
    const hostilePath = join(dir, "11-hostile-casts-raw.json");
    const deathsPath = join(dir, "12-deaths-raw.json");
    const merge = async (
      path: string,
      row: Record<string, unknown>,
    ): Promise<void> => {
      const prev = existsSync(path)
        ? (JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>)
        : [];
      const map = new Map(prev.map((r) => [String(r.runId), r]));
      map.set(runId, row);
      await writeJson(path, [...map.values()]);
    };
    await merge(hostilePath, {
      runId,
      reportCode: run.reportCode,
      fightId: run.fightId,
      dungeonSlug: run.dungeonSlug,
      playerActorId: run.playerActorId,
      analysisVersion: WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
      hostilityType: "Enemies",
      filterExpression: HOSTILE_CAST_FILTER_EXPRESSION,
      dataset: hostile.dataset,
      payloadFingerprint: fingerprintPayload(hostile.dataset.events),
    });
    await merge(deathsPath, {
      runId,
      reportCode: run.reportCode,
      fightId: run.fightId,
      dungeonSlug: run.dungeonSlug,
      dataset: deaths.dataset,
    });

    return {
      eventCalls,
      hostileEvents: hostile.dataset.eventCount,
      deathEvents: deaths.dataset.eventCount,
    };
  };

  const reusePass = async () => {
    let eventCalls = 0;
    let hostileEvents = 0;
    let deathEvents = 0;
    for (const run of runs) {
      const bundle = await ingestSharedEvidenceBundle({
        client,
        store,
        reportCode: run.reportCode,
        reportRevision: null,
        fightId: run.fightId,
        playerActorId: run.playerActorId,
        ownedPetActorIds: run.petActorIds ?? [],
        dungeonSlug: run.dungeonSlug,
        startTime: null,
        endTime: run.durationMs ?? null,
        consumers: ["survival", "utility"],
        datasets: ["HostileCasts", "Deaths"],
        forceRefetch: false,
        region: options.region,
        coalesceKey: `reuse:${run.reportCode}:${run.fightId}`,
      });
      eventCalls += bundle.accounting.providerCalls;
      hostileEvents += bundle.eventDatasets.HostileCasts?.eventCount ?? 0;
      deathEvents += bundle.eventDatasets.Deaths?.eventCount ?? 0;
    }
    return { eventCalls, hostileEvents, deathEvents };
  };

  console.log(`\n[shared-evidence] ${label} pass=first (provider fetch)`);
  let first = { eventCalls: 0, hostileEvents: 0, deathEvents: 0 };
  for (const run of runs) {
    const hostilePath = join(dir, "11-hostile-casts-raw.json");
    const deathsPath = join(dir, "12-deaths-raw.json");
    let hostileReady = false;
    let deathsReady = false;

    if (!options.forceRefetch && existsSync(hostilePath)) {
      const rows = JSON.parse(await readFile(hostilePath, "utf8")) as Array<{
        reportCode: string;
        fightId: number;
        dataset?: WclRunEvidenceDataset;
      }>;
      const row = rows.find(
        (r) => r.reportCode === run.reportCode && r.fightId === run.fightId && r.dataset,
      );
      if (row?.dataset && (row.dataset.eventCount ?? 0) >= 0 && row.dataset.state !== "ERROR") {
        const ds = {
          ...row.dataset,
          costSource: row.dataset.costSource ?? "measured",
          requestCostUnits: row.dataset.requestCostUnits ?? [],
        };
        await store.saveDataset(
          datasetKey(
            run.reportCode,
            run.fightId,
            run.playerActorId,
            "HostileCasts",
            run.durationMs ?? null,
          ),
          ds,
          {
            reportCode: run.reportCode,
            reportRevision: null,
            fightId: run.fightId,
            dataset: "HostileCasts",
          },
        );
        first.hostileEvents += ds.eventCount;
        hostileReady = true;
      }
    }

    if (!options.forceRefetch && existsSync(deathsPath)) {
      const rows = JSON.parse(await readFile(deathsPath, "utf8")) as Array<{
        reportCode: string;
        fightId: number;
        dataset?: WclRunEvidenceDataset;
      }>;
      const row = rows.find(
        (r) => r.reportCode === run.reportCode && r.fightId === run.fightId && r.dataset,
      );
      if (row?.dataset && row.dataset.state !== "ERROR") {
        const ds = {
          ...row.dataset,
          costSource: row.dataset.costSource ?? "measured",
          requestCostUnits: row.dataset.requestCostUnits ?? [],
        };
        await store.saveDataset(
          datasetKey(
            run.reportCode,
            run.fightId,
            run.playerActorId,
            "Deaths",
            run.durationMs ?? null,
          ),
          ds,
          {
            reportCode: run.reportCode,
            reportRevision: null,
            fightId: run.fightId,
            dataset: "Deaths",
          },
        );
        first.deathEvents += ds.eventCount;
        deathsReady = true;
      }
    }

    if (!hostileReady || !deathsReady) {
      const got = await fetchAndPersist(run);
      first.eventCalls += got.eventCalls;
      if (!hostileReady) first.hostileEvents += got.hostileEvents;
      if (!deathsReady) first.deathEvents += got.deathEvents;
    }
  }

  console.log(`\n[shared-evidence] ${label} pass=second (must be zero event calls)`);
  const second = await reusePass();
  const batchCost = await tracker.end(client, options.region);

  const report = {
    character: label,
    analysisVersion: WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
    utilityEnabled: false,
    runs: runs.map((r) => `${r.reportCode}:${r.fightId}`),
    firstPass: first,
    secondPass: second,
    secondPassZeroEventCalls: second.eventCalls === 0,
    batchCost: {
      ...batchCost,
      pointsConsumedDisplay: formatPointsConsumed(batchCost),
    },
    generatedAt: new Date().toISOString(),
  };
  const reportPath = join(outDir, `${options.name.toLowerCase()}-shared-evidence-load.json`);
  await writeJson(reportPath, report);
  console.log(
    `  first eventCalls=${first.eventCalls} hostile=${first.hostileEvents}` +
      ` second eventCalls=${second.eventCalls}` +
      ` points=${formatPointsConsumed(batchCost)}`,
  );
  console.log(`  report → ${reportPath}`);
  if (!report.secondPassZeroEventCalls) {
    throw new Error("Second shared-evidence load made WCL event calls — reuse failed");
  }
  return { reportPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { reportPath } = await runSharedEvidenceCharacterLoad(args);
  console.log(JSON.stringify({ reportPath, ok: true }, null, 2));
}

if (
  process.argv[1]?.includes("run-shared-evidence-load") ||
  process.argv[1]?.includes("shared-evidence-load")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
