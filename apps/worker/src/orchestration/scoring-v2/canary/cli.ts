/**
 * Guarded Scoring V2 one-character canary CLI.
 *
 * Phase A (zero WCL by default):
 *   pnpm scoring-v2:canary:preflight -- --region EU --realm archimonde --character Wallidrixe --zone-id 42
 *
 * Phase B (refuses without --confirm-live; not run in automation):
 *   pnpm scoring-v2:canary:live -- --region EU --realm archimonde --character Wallidrixe --zone-id 42 --confirm-live
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv, type AppEnv } from "@mplus/config";
import { EVIDENCE_SELECTOR_VERSION } from "@mplus/contracts";
import { createMemoryOrchestrationPorts } from "../run-orchestration/memory-ports.js";
import { runScoringV2CanaryPreflight } from "../run-orchestration/canary-preflight.js";
import {
  isScoringV2ShadowOrchestrationEnabled,
  assertPublicationBlocked,
} from "../acquisition.js";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";

export interface CanaryCliArgs {
  mode: "preflight" | "live";
  region: string;
  realm: string;
  character: string;
  zoneId: number | null;
  confirmLive: boolean;
  outputDir: string | null;
  /** Test seam — skip DB character resolution. */
  characterId?: string;
  seasonId?: string;
  candidates?: EvidenceCandidateMetadataV2[];
  activeDungeonSlugs?: string[];
}

export function parseCanaryCliArgs(argv: string[]): CanaryCliArgs {
  const args = [...argv];
  let mode: "preflight" | "live" = "preflight";
  if (args[0] === "live" || args[0] === "preflight") {
    mode = args.shift() as "preflight" | "live";
  }
  let region = "";
  let realm = "";
  let character = "";
  let zoneId: number | null = null;
  let confirmLive = false;
  let outputDir: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const next = args[i + 1];
    if (a === "--region" && next) {
      region = next;
      i++;
    } else if (a === "--realm" && next) {
      realm = next;
      i++;
    } else if ((a === "--character" || a === "--name") && next) {
      character = next;
      i++;
    } else if (a === "--zone-id" && next) {
      zoneId = Number(next);
      i++;
    } else if (a === "--confirm-live") {
      confirmLive = true;
    } else if (a === "--output-dir" && next) {
      outputDir = next;
      i++;
    } else if (a === "--mode" && next) {
      mode = next === "live" ? "live" : "preflight";
      i++;
    }
  }

  if (!region || !realm || !character) {
    throw Object.assign(
      new Error("required: --region --realm --character"),
      { code: "CANARY_ARGS_INCOMPLETE" },
    );
  }
  if (/[*?]/.test(character) || character.toLowerCase() === "all") {
    throw Object.assign(new Error("canary_refuses_wildcard_or_cohort"), {
      code: "CANARY_REFUSES_BATCH",
    });
  }

  return {
    mode,
    region: region.toLowerCase(),
    realm: realm.toLowerCase(),
    character,
    zoneId,
    confirmLive,
    outputDir,
  };
}

export interface CanaryLiveGateInput {
  env: Pick<
    AppEnv,
    | "PROVIDER_MODE"
    | "WCL_ENABLED"
    | "ALLOW_LIVE_PROVIDER_CALLS"
    | "SCORING_V2_ENABLED"
    | "SCORING_V2_SELECTION_ENABLED"
    | "SCORING_V2_EVIDENCE_FETCH_ENABLED"
    | "SCORING_V2_PUBLICATION_ENABLED"
    | "WCL_CLIENT_ID"
    | "WCL_CLIENT_SECRET"
  >;
  confirmLive: boolean;
  characterCount: number;
}

export type CanaryLiveGateDenial =
  | "MISSING_CONFIRM_LIVE"
  | "PROVIDER_MODE_NOT_LIVE"
  | "ALLOW_LIVE_PROVIDER_CALLS_FALSE"
  | "SHADOW_FLAGS_DISABLED"
  | "PUBLICATION_ENABLED"
  | "MULTIPLE_CHARACTERS"
  | "WCL_CREDENTIALS_MISSING"
  | "WCL_DISABLED";

export function evaluateCanaryLiveGates(
  input: CanaryLiveGateInput,
): { allowed: true } | { allowed: false; reasons: CanaryLiveGateDenial[] } {
  const reasons: CanaryLiveGateDenial[] = [];
  if (!input.confirmLive) reasons.push("MISSING_CONFIRM_LIVE");
  if (input.env.PROVIDER_MODE !== "live") reasons.push("PROVIDER_MODE_NOT_LIVE");
  if (!input.env.ALLOW_LIVE_PROVIDER_CALLS) {
    reasons.push("ALLOW_LIVE_PROVIDER_CALLS_FALSE");
  }
  if (!isScoringV2ShadowOrchestrationEnabled(input.env as never)) {
    reasons.push("SHADOW_FLAGS_DISABLED");
  }
  if (input.env.SCORING_V2_PUBLICATION_ENABLED) {
    reasons.push("PUBLICATION_ENABLED");
  }
  if (input.characterCount !== 1) reasons.push("MULTIPLE_CHARACTERS");
  if (!input.env.WCL_ENABLED) reasons.push("WCL_DISABLED");
  if (!input.env.WCL_CLIENT_ID || !input.env.WCL_CLIENT_SECRET) {
    reasons.push("WCL_CREDENTIALS_MISSING");
  }
  if (reasons.length > 0) return { allowed: false, reasons };
  try {
    assertPublicationBlocked(input.env as never);
  } catch {
    return { allowed: false, reasons: ["PUBLICATION_ENABLED"] };
  }
  return { allowed: true };
}

export async function runCanaryPreflightCommand(
  args: CanaryCliArgs,
  options?: {
    ports?: ReturnType<typeof createMemoryOrchestrationPorts>;
    candidates?: EvidenceCandidateMetadataV2[];
    activeDungeonSlugs?: string[];
    characterId?: string;
    seasonId?: string;
  },
): Promise<{ reportPath: string; report: Awaited<ReturnType<typeof runScoringV2CanaryPreflight>> }> {
  const env = loadEnv();
  const characterId =
    options?.characterId ?? args.characterId ?? "00000000-0000-4000-8000-000000000001";
  const seasonId = options?.seasonId ?? args.seasonId ?? "season-canary";
  const activeDungeonSlugs =
    options?.activeDungeonSlugs ??
    args.activeDungeonSlugs ??
    [
      "ara-kara-city-of-echoes",
      "eco-dome-aldani",
      "halls-of-atonement",
      "operation-floodgate",
      "priory-of-the-sacred-flame",
      "tazavesh-streets-of-wonder",
      "the-dawnbreaker",
      "the-rookery",
    ];
  const candidates = options?.candidates ?? args.candidates ?? [];
  const ports =
    options?.ports ??
    createMemoryOrchestrationPorts({ autoSeedRanking: false });

  const report = await runScoringV2CanaryPreflight({
    characterId,
    characterName: args.character,
    region: args.region,
    realm: args.realm,
    seasonId,
    scoringModelId: "canary-model",
    scope: {
      characterId,
      seasonId,
      seasonSlug: seasonId,
      specializationId: null,
      classSlug: null,
      specSlug: null,
      role: "DPS",
      refreshContractHash: "canary-preflight",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs,
    },
    candidates,
    ports,
    rateBudgetConfig: {
      warnPercent: env.WCL_RATE_WARN_PERCENT,
      deferPercent: env.WCL_RATE_DEFER_PERCENT,
      stopPercent: env.WCL_RATE_STOP_PERCENT,
    },
    rateLimitSnapshot: null,
    rateLimitSnapshotIsProviderCall: false,
  });

  if (report.providerCalls !== 0) {
    throw new Error("preflight_must_make_zero_provider_calls");
  }

  const outDir =
    args.outputDir ??
    join(process.cwd(), "artifacts", "scoring-v2-canary");
  await mkdir(outDir, { recursive: true });
  const reportPath = join(
    outDir,
    `preflight-${args.region}-${args.realm}-${args.character}.json`,
  );
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { reportPath, report };
}

export async function runCanaryLiveCommand(
  args: CanaryCliArgs,
): Promise<never> {
  const env = loadEnv();
  const gate = evaluateCanaryLiveGates({
    env,
    confirmLive: args.confirmLive,
    characterCount: 1,
  });
  if (!gate.allowed) {
    throw Object.assign(
      new Error(`canary_live_refused:${gate.reasons.join(",")}`),
      { code: "CANARY_LIVE_REFUSED", reasons: gate.reasons },
    );
  }

  // Live execution is intentionally not invoked from this task / automation.
  // The command validates gates then refuses with an explicit operator message
  // unless SCORING_V2_CANARY_EXECUTE=true is set by a human.
  if (process.env.SCORING_V2_CANARY_EXECUTE !== "true") {
    throw Object.assign(
      new Error(
        "canary_live_gates_passed_but_execute_not_armed: set SCORING_V2_CANARY_EXECUTE=true after human approval",
      ),
      { code: "CANARY_EXECUTE_NOT_ARMED" },
    );
  }

  // Armed path reserved for human-approved canary — still never enable publication.
  assertPublicationBlocked(env);
  throw Object.assign(
    new Error("canary_live_execute_path_reserved_for_human_approval"),
    { code: "CANARY_EXECUTE_RESERVED" },
  );
}

async function main(): Promise<void> {
  const args = parseCanaryCliArgs(process.argv.slice(2));
  if (args.mode === "live") {
    await runCanaryLiveCommand(args);
    return;
  }
  const { reportPath, report } = await runCanaryPreflightCommand(args);
  console.log(
    JSON.stringify(
      {
        reportPath,
        providerCalls: report.providerCalls,
        selectedSlotCount: report.selectedSlotCount,
        fightsRequiringWcl: report.fightsRequiringWcl.length,
        rankingFactsMissing: report.rankingFactsMissing.length,
        blockers: report.blockers,
        publicationEligible: report.publicationEligible,
      },
      null,
      2,
    ),
  );
}

const isDirect =
  process.argv[1]?.includes("canary") ||
  process.argv[1]?.includes("scoring-v2-canary");

if (isDirect) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
