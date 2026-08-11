import type { MythicRunDTO } from "@mplus/contracts";
import {
  rankingsToCandidates,
  type WclRankingObservation,
} from "@mplus/provider-warcraftlogs";
import {
  canonicalDungeonKey,
  evaluateCrossProviderPersistMatch,
} from "./run-fusion.js";

export interface SurvivalWclBindCandidate {
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  keyLevel: number;
  completedAt: string;
  durationMs: number;
  origin: "discovered_run" | "zone_ranking";
}

export interface SurvivalExternalRunMatchInput {
  dungeonSlug: string;
  keyLevel: number;
  completedAt: string;
  durationMs: number;
}

export type SurvivalWclBindResult =
  | {
      matched: true;
      reportCode: string;
      fightId: number;
      origin: SurvivalWclBindCandidate["origin"];
      lateBound: boolean;
    }
  | {
      matched: false;
      reason: string;
    };

/**
 * Build a Survival report/fight pool from this refresh's discovery output.
 * Independent of whether fusion attached WARCRAFT_LOGS onto canonical selectedRuns.
 */
export function buildSurvivalWclBindPool(
  discoveredRuns: MythicRunDTO[],
  rankings: WclRankingObservation[],
): SurvivalWclBindCandidate[] {
  const out: SurvivalWclBindCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: SurvivalWclBindCandidate) => {
    if (!candidate.reportCode || candidate.fightId <= 0) return;
    const key = `${candidate.reportCode}:${candidate.fightId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  for (const run of discoveredRuns) {
    for (const source of run.sources) {
      if (source.provider !== "WARCRAFT_LOGS") continue;
      if (!source.reportCode || source.fightId == null || source.fightId <= 0) continue;
      push({
        reportCode: source.reportCode,
        fightId: source.fightId,
        dungeonSlug: run.dungeonSlug,
        keyLevel: run.keyLevel,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        origin: "discovered_run",
      });
    }
  }

  for (const rankingCandidate of rankingsToCandidates(rankings)) {
        if (rankingCandidate.fightId <= 0 || !rankingCandidate.reportCode) continue;
    if (rankingCandidate.keyLevel == null) continue;
    if (!rankingCandidate.completedAt) continue;
    push({
      reportCode: rankingCandidate.reportCode,
      fightId: rankingCandidate.fightId,
      dungeonSlug: rankingCandidate.dungeonSlug ?? "unknown",
      keyLevel: rankingCandidate.keyLevel,
      completedAt: rankingCandidate.completedAt,
      durationMs: rankingCandidate.durationMs ?? 0,
      origin: "zone_ranking",
    });
  }

  return out;
}

function matchQuality(candidate: SurvivalWclBindCandidate, external: SurvivalExternalRunMatchInput): number {
  const dungeonKnown =
    canonicalDungeonKey(candidate.dungeonSlug) === canonicalDungeonKey(external.dungeonSlug) &&
    !isUnknownDungeon(candidate.dungeonSlug);
  const timeDeltaMs = Math.abs(
    new Date(candidate.completedAt).getTime() - new Date(external.completedAt).getTime(),
  );
  // Prefer exact dungeon, then tighter completion time.
  return (dungeonKnown ? 1_000_000_000 : 0) - timeDeltaMs;
}

function isUnknownDungeon(slug: string): boolean {
  const normalized = slug?.normalize("NFKC").trim().toLocaleLowerCase("en-US") ?? "";
  return !normalized || normalized === "unknown";
}

/**
 * Match a canonical external run to a usable WCL report+fight without requiring
 * selectedRuns.wclReportMatched / pre-attached RunSourceReference rows.
 */
export function matchSurvivalWclSource(
  external: SurvivalExternalRunMatchInput,
  pool: SurvivalWclBindCandidate[],
  options?: { excludeReportFightKeys?: Set<string> },
): SurvivalWclBindResult {
  if (pool.length === 0) {
    return { matched: false, reason: "no_wcl_bind_pool_candidates" };
  }

  const exclude = options?.excludeReportFightKeys ?? new Set<string>();
  let best: SurvivalWclBindCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of pool) {
    const key = `${candidate.reportCode}:${candidate.fightId}`;
    if (exclude.has(key)) continue;
    const { matched } = evaluateCrossProviderPersistMatch(external, candidate);
    if (!matched) continue;
    const score = matchQuality(candidate, external);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (!best) {
    return { matched: false, reason: "no_usable_wcl_report_match" };
  }

  return {
    matched: true,
    reportCode: best.reportCode,
    fightId: best.fightId,
    origin: best.origin,
    lateBound: true,
  };
}
