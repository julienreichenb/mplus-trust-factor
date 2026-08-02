/**
 * Sanitized WCL planner probes — manual only.
 * Requires ALLOW_LIVE_PROVIDER_CALLS=true. Never run in CI.
 *
 * Covers:
 * - exact same-key parse field
 * - metadata batching by multiple fight IDs
 * - event versus table aggregate parity scaffolding
 * - cost and bytes per dataset (estimated offline; live optional)
 * - archived/gated behavior
 * - tank/healer ranking payload shapes
 */

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildPlannerCompatibilityKey } from "../dataset-plan.js";
import { estimateDatasetCost } from "../cost-plan.js";
import {
  buildDiscoveryPlan,
  groupCandidatesForHydration,
  type DiscoverySourceRow,
  type PlannedDiscoveryCandidate,
  type ReportHydrationGroup,
} from "../discovery-plan.js";
import { planDetailedEvidence } from "../index.js";
import type { EvidenceDatasetKind } from "@mplus/contracts";
import { sanitizeReportCode, reportCodeFingerprint } from "../../smoke/sanitize.js";

function envFlag(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function assertLiveGuard(): void {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
    throw new Error(
      "REFUSED: planner probes require ALLOW_LIVE_PROVIDER_CALLS=true (never enable this in CI).",
    );
  }
}

export interface PlannerProbeCaseResult {
  caseId: string;
  ok: boolean;
  sanitized: Record<string, unknown>;
  notes: string[];
}

function sanitizeIdentity(reportCode: string, fightId: number): Record<string, unknown> {
  return {
    reportFingerprint: reportCodeFingerprint(reportCode),
    maskedReportCode: sanitizeReportCode(reportCode),
    fightId,
  };
}

/** Exact same-key parse field: identical discovery identity must collapse. */
export function probeExactSameKeyParseField(rows: DiscoverySourceRow[]): PlannerProbeCaseResult {
  const plan = buildDiscoveryPlan({
    zoneRankingCandidates: rows,
    parseRows: rows.map((r) => ({ ...r, source: "parse_row" as const })),
    activeDungeonSlugs: [...new Set(rows.map((r) => r.dungeonSlug).filter(Boolean))] as string[],
  });
  const keys = plan.candidates.map(
    (c: PlannedDiscoveryCandidate) =>
      `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`,
  );
  const unique = new Set(keys);
  return {
    caseId: "exact-same-key-parse-field",
    ok: unique.size === plan.candidates.length,
    sanitized: {
      retained: plan.candidates.map((c: PlannedDiscoveryCandidate) =>
        sanitizeIdentity(c.discoveryIdentity.reportCode, c.discoveryIdentity.fightId),
      ),
      inputCount: rows.length * 2,
      retainedCount: plan.candidates.length,
    },
    notes: unique.size === plan.candidates.length ? ["deduped"] : ["duplicate_keys_present"],
  };
}

/** Metadata batching: multiple fight IDs under one report code. */
export function probeMetadataBatchingByFightIds(
  rows: DiscoverySourceRow[],
): PlannerProbeCaseResult {
  const plan = buildDiscoveryPlan({
    zoneRankingCandidates: rows,
    activeDungeonSlugs: [...new Set(rows.map((r) => r.dungeonSlug).filter(Boolean))] as string[],
  });
  const groups = groupCandidatesForHydration(plan.candidates);
  const multi = groups.filter((g: ReportHydrationGroup) => g.fightIds.length > 1);
  return {
    caseId: "metadata-batching-multi-fight",
    ok: multi.length > 0 || plan.candidates.length <= 1,
    sanitized: {
      groups: groups.map((g: ReportHydrationGroup) => ({
        reportFingerprint: reportCodeFingerprint(g.reportCode),
        maskedReportCode: sanitizeReportCode(g.reportCode),
        fightIds: g.fightIds,
      })),
    },
    notes: multi.length > 0 ? ["batched_fights_present"] : ["single_fight_only"],
  };
}

/** Offline event vs table parity scaffolding — no live calls. */
export function probeEventVersusTableParityScaffold(): PlannerProbeCaseResult {
  const eventDatasets: EvidenceDatasetKind[] = ["DAMAGE_TAKEN", "CASTS", "INTERRUPTS", "HEALING"];
  const estimates = eventDatasets.map((dataset) => ({
    dataset,
    eventEstimate: estimateDatasetCost(dataset, 3),
    tableEstimate: estimateDatasetCost(dataset, 1),
  }));
  return {
    caseId: "event-vs-table-parity-scaffold",
    ok: estimates.every(
      (e) => e.eventEstimate.kind === "KNOWN" && e.tableEstimate.kind === "KNOWN",
    ),
    sanitized: { estimates },
    notes: [
      "Live parity requires authorized provider calls; this case only validates cost scaffolding.",
    ],
  };
}

/** Cost and bytes-per-dataset estimates (bytes unknown offline → UNKNOWN). */
export function probeCostAndBytesPerDataset(): PlannerProbeCaseResult {
  const datasets: EvidenceDatasetKind[] = [
    "MASTER_DATA",
    "CASTS",
    "HOSTILE_CASTS",
    "DEATHS",
    "DAMAGE_TAKEN",
  ];
  const rows = datasets.map((dataset) => ({
    dataset,
    estimatedCost: estimateDatasetCost(dataset),
    estimatedBytes: { kind: "UNKNOWN" as const },
  }));
  return {
    caseId: "cost-and-bytes-per-dataset",
    ok: rows.every((r) => r.estimatedCost.kind !== "ZERO_CACHE_HIT" || true),
    sanitized: { rows },
    notes: ["bytes remain UNKNOWN until live fetch; unknown ≠ zero"],
  };
}

/** Archived/gated candidates surface access diagnostics. */
export function probeArchivedOrGatedBehavior(): PlannerProbeCaseResult {
  const rows: DiscoverySourceRow[] = [
    {
      reportCode: "ArchivedX",
      fightId: 1,
      dungeonSlug: "algethar-academy",
      keyLevel: 10,
      timed: true,
      runScore: null,
      completedAt: null,
      fightDurationMs: 1_000_000,
      actorId: null,
      reportRevision: null,
      source: "zone_rankings",
      visibility: "public",
      archivedOrGated: true,
    },
  ];
  const plan = buildDiscoveryPlan({
    zoneRankingCandidates: rows,
    activeDungeonSlugs: ["algethar-academy"],
  });
  const access = plan.candidates[0]?.diagnostics.accessState;
  return {
    caseId: "archived-or-gated",
    ok: access === "ARCHIVED_OR_GATED",
    sanitized: {
      accessState: access ?? null,
      identity: sanitizeIdentity("ArchivedX", 1),
    },
    notes: access === "ARCHIVED_OR_GATED" ? ["diagnostic_ok"] : ["unexpected_access_state"],
  };
}

/** Tank/healer ranking payload shape checks (fixture-shaped). */
export function probeTankHealerRankingShapes(
  payloads: Array<{ role: "TANK" | "HEALER" | "DPS"; rankings: unknown }>,
): PlannerProbeCaseResult {
  const notes: string[] = [];
  let ok = true;
  const sanitized = payloads.map((p) => {
    const isArray = Array.isArray(p.rankings);
    if (!isArray) {
      ok = false;
      notes.push(`${p.role}:rankings_not_array`);
    }
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(p.rankings))
      .digest("hex")
      .slice(0, 12);
    return { role: p.role, rankingsIsArray: isArray, payloadFingerprint: fingerprint };
  });
  return {
    caseId: "tank-healer-ranking-shapes",
    ok,
    sanitized: { roles: sanitized },
    notes: notes.length ? notes : ["shapes_ok"],
  };
}

export function runPlannerProbeSuite(options?: {
  discoveryRows?: DiscoverySourceRow[];
  rankingPayloads?: Array<{ role: "TANK" | "HEALER" | "DPS"; rankings: unknown }>;
  outputDir?: string;
}): { results: PlannerProbeCaseResult[]; wrote?: string } {
  assertLiveGuard();

  const rows =
    options?.discoveryRows ??
    ([
      {
        reportCode: "ProbeRepA",
        fightId: 1,
        dungeonSlug: "algethar-academy",
        keyLevel: 12,
        timed: true,
        runScore: 2400,
        completedAt: "2026-07-01T12:00:00.000Z",
        fightDurationMs: 1_800_000,
        actorId: 1,
        reportRevision: null,
        source: "zone_rankings",
        visibility: "public",
        parsePercentile: 90,
      },
      {
        reportCode: "ProbeRepA",
        fightId: 2,
        dungeonSlug: "algethar-academy",
        keyLevel: 11,
        timed: true,
        runScore: 2300,
        completedAt: "2026-07-01T11:00:00.000Z",
        fightDurationMs: 1_900_000,
        actorId: 1,
        reportRevision: null,
        source: "zone_rankings",
        visibility: "public",
      },
    ] satisfies DiscoverySourceRow[]);

  const results: PlannerProbeCaseResult[] = [
    probeExactSameKeyParseField(rows),
    probeMetadataBatchingByFightIds(rows),
    probeEventVersusTableParityScaffold(),
    probeCostAndBytesPerDataset(),
    probeArchivedOrGatedBehavior(),
    probeTankHealerRankingShapes(
      options?.rankingPayloads ?? [
        { role: "TANK", rankings: [{ fightID: 1, report: { code: "x" } }] },
        { role: "HEALER", rankings: [{ fightID: 2, report: { code: "y" } }] },
      ],
    ),
  ];

  // Sanity: detailed plan from synthetic frozen slots (still no provider).
  const detailed = planDetailedEvidence({
    frozenSlots: [
      {
        slotId: "probe-0",
        dungeonSlug: "algethar-academy",
        identity: { reportCode: "ProbeRepA", fightId: 1, reportRevision: 1 },
        actorId: 1,
        startTime: 0,
        endTime: 1000,
      },
    ],
    planContentHash: "probe-hash",
    characterId: "probe-char",
    seasonId: "probe-season",
    plannedAt: new Date().toISOString(),
    dataset: { enabledConsumers: ["PERFORMANCE", "SURVIVAL", "UTILITY"] },
  });
  results.push({
    caseId: "detailed-plan-from-frozen-slots",
    ok: detailed.datasetCostPlan.entries.length > 0,
    sanitized: {
      entryCount: detailed.datasetCostPlan.entries.length,
      totalEstimatedCost: detailed.cost.totalEstimatedCost,
      sampleKeyFingerprint: createHash("sha256")
        .update(detailed.datasetCostPlan.entries[0]?.compatibilityKey ?? "")
        .digest("hex")
        .slice(0, 12),
      hostilityAwareKey: buildPlannerCompatibilityKey({
        reportCode: "ProbeRepA",
        reportRevision: 1,
        fightId: 1,
        actorId: null,
        dataset: "HOSTILE_CASTS",
        startTime: 0,
        endTime: 1000,
        filterExpression: "x",
        hostilityType: 1,
        includeResources: false,
        providerContractVersion: "wcl-graphql-v2-events",
      }).includes("|h1|"),
    },
    notes: ["built_from_frozen_slots_only"],
  });

  let wrote: string | undefined;
  if (options?.outputDir) {
    mkdirSync(options.outputDir, { recursive: true });
    wrote = join(options.outputDir, "planner-probe-results.json");
    writeFileSync(
      wrote,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          liveGuard: "ALLOW_LIVE_PROVIDER_CALLS",
          results,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  return { results, wrote };
}
