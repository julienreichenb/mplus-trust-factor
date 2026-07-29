import { describe, expect, it } from "vitest";
import type { MythicRunDTO } from "@mplus/contracts";
import type { WclRankingObservation } from "@mplus/provider-warcraftlogs";
import {
  buildSurvivalWclBindPool,
  matchSurvivalWclSource,
} from "./survival-wcl-late-bind.js";

function ranking(
  overrides: Partial<WclRankingObservation> &
    Pick<WclRankingObservation, "reportCode" | "fightId" | "keyLevel">,
): WclRankingObservation {
  return {
    reportCode: overrides.reportCode,
    fightId: overrides.fightId,
    encounterId: overrides.encounterId ?? 0,
    zoneId: overrides.zoneId ?? 42,
    bracket: overrides.keyLevel,
    keyLevel: overrides.keyLevel,
    score: overrides.score ?? null,
    amount: overrides.amount ?? null,
    percentile: overrides.percentile ?? null,
    rankPercent: null,
    bracketPercent: null,
    specSlug: null,
    roleSlug: null,
    durationMs: overrides.durationMs ?? 1_800_000,
    startTimeMs: overrides.startTimeMs ?? 0,
    reportStartTimeMs: overrides.reportStartTimeMs ?? Date.parse("2026-07-01T12:00:00.000Z"),
    timed: null,
    metric: null,
  };
}

function discoveredRun(overrides: {
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  keyLevel: number;
  completedAt: string;
  durationMs?: number;
}): MythicRunDTO {
  return {
    id: `${overrides.reportCode}-${overrides.fightId}`,
    region: "eu",
    seasonSlug: "season-midnight-s1",
    dungeonSlug: overrides.dungeonSlug,
    keyLevel: overrides.keyLevel,
    completedAt: overrides.completedAt,
    durationMs: overrides.durationMs ?? 1_800_000,
    timerMs: null,
    timed: true,
    scoreValue: 300,
    canonicalFingerprint: `fp-${overrides.reportCode}-${overrides.fightId}`,
    affixes: [],
    participants: [],
    sources: [
      {
        provider: "WARCRAFT_LOGS",
        externalRunId: `${overrides.reportCode}:${overrides.fightId}`,
        externalUrl: null,
        reportCode: overrides.reportCode,
        fightId: overrides.fightId,
        revision: null,
      },
    ],
  };
}

describe("survival WCL late-bind", () => {
  it("builds a pool from discovered runs and zone rankings independently of fusion", () => {
    const pool = buildSurvivalWclBindPool(
      [
        discoveredRun({
          reportCode: "Disc1",
          fightId: 2,
          dungeonSlug: "skyreach",
          keyLevel: 18,
          completedAt: "2026-07-01T12:00:00.000Z",
        }),
      ],
      [
        ranking({
          reportCode: "Rank1",
          fightId: 4,
          keyLevel: 20,
          encounterId: 0,
          durationMs: 1_750_000,
        }),
      ],
    );
    expect(pool.map((c) => `${c.reportCode}:${c.fightId}`).sort()).toEqual([
      "Disc1:2",
      "Rank1:4",
    ]);
  });

  it("matches an unattached canonical run via zone ranking timing", () => {
    const completedAt = "2026-07-01T12:00:00.000Z";
    const pool = buildSurvivalWclBindPool(
      [],
      [
        ranking({
          reportCode: "Abc123",
          fightId: 7,
          keyLevel: 16,
          durationMs: 1_800_000,
          reportStartTimeMs: Date.parse(completedAt),
          startTimeMs: 0,
        }),
      ],
    );
    const matched = matchSurvivalWclSource(
      {
        dungeonSlug: "skyreach",
        keyLevel: 16,
        completedAt,
        durationMs: 1_800_000,
      },
      pool,
    );
    expect(matched.matched).toBe(true);
    if (matched.matched) {
      expect(matched.reportCode).toBe("Abc123");
      expect(matched.fightId).toBe(7);
      expect(matched.lateBound).toBe(true);
      expect(matched.origin).toBe("zone_ranking");
    }
  });

  /**
   * Regression: post-merge production rejected every Survival candidate with
   * `no_usable_wcl_report` when selectedRuns.wclReportMatched=false and fusion
   * left no WARCRAFT_LOGS source — before any report discovery / GraphQL.
   * Late-bind must still resolve report+fight from this refresh's rankings pool.
   */
  it("regression: does not pre-fetch-reject when wclReportMatched is false but rankings have a fight", () => {
    const completedAt = "2026-07-10T18:30:00.000Z";
    // Simulate fusion miss: no discovered MythicRun sources attached to the canonical row.
    const pool = buildSurvivalWclBindPool(
      [],
      [
        ranking({
          reportCode: "WallFix1",
          fightId: 3,
          keyLevel: 18,
          durationMs: 1_920_000,
          reportStartTimeMs: Date.parse(completedAt),
          startTimeMs: 0,
        }),
      ],
    );
    expect(pool.length).toBeGreaterThan(0);

    // Canonical selected run with hasWclSource / wclReportMatched = false.
    const bind = matchSurvivalWclSource(
      {
        dungeonSlug: "skyreach",
        keyLevel: 18,
        completedAt,
        durationMs: 1_920_000,
      },
      pool,
    );

    expect(bind.matched).toBe(true);
    if (bind.matched) {
      expect(bind.reportCode).toBe("WallFix1");
      expect(bind.fightId).toBe(3);
      expect(bind.lateBound).toBe(true);
    }
    // Must not surface the old blind pre-fetch reason.
    expect(bind).not.toMatchObject({ reason: "no_usable_wcl_report" });
  });

  it("rejects when no pool candidate shares key + time/duration", () => {
    const pool = buildSurvivalWclBindPool(
      [],
      [
        ranking({
          reportCode: "Abc123",
          fightId: 7,
          keyLevel: 10,
          durationMs: 1_800_000,
          reportStartTimeMs: Date.parse("2026-01-01T00:00:00.000Z"),
          startTimeMs: 0,
        }),
      ],
    );
    const matched = matchSurvivalWclSource(
      {
        dungeonSlug: "skyreach",
        keyLevel: 16,
        completedAt: "2026-07-01T12:00:00.000Z",
        durationMs: 1_800_000,
      },
      pool,
    );
    expect(matched).toEqual({ matched: false, reason: "no_usable_wcl_report_match" });
  });

  it("exposes empty-pool rejection reason", () => {
    expect(
      matchSurvivalWclSource(
        {
          dungeonSlug: "skyreach",
          keyLevel: 16,
          completedAt: "2026-07-01T12:00:00.000Z",
          durationMs: 1_800_000,
        },
        [],
      ),
    ).toEqual({ matched: false, reason: "no_wcl_bind_pool_candidates" });
  });
});
