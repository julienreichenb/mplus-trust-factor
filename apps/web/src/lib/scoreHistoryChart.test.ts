import { describe, expect, it } from "vitest";
import type { ScoreSnapshotDTO } from "@mplus/contracts";
import {
  buildScoreHistoryChartOption,
  mapScoreHistoryPoints,
  scoreHistorySeasonBands,
  scoreHistoryTooltipHtml,
} from "./scoreHistoryChart";

function snapshot(overrides: Partial<ScoreSnapshotDTO>): ScoreSnapshotDTO {
  return {
    calculatedAt: "2026-09-01T12:00:00.000Z",
    seasonSlug: "season-1",
    modelKey: "test-model",
    overallScore: 80,
    scoreContext: { rawScoreBeforeContext: 70 } as ScoreSnapshotDTO["scoreContext"],
    ...overrides,
  } as ScoreSnapshotDTO;
}

describe("scoreHistoryChart", () => {
  it("orders snapshots chronologically and maps raw/adjusted scores", () => {
    const points = mapScoreHistoryPoints([
      snapshot({
        calculatedAt: "2026-09-02T10:00:00.000Z",
        overallScore: 90,
        scoreContext: { rawScoreBeforeContext: 88 } as ScoreSnapshotDTO["scoreContext"],
      }),
      snapshot({
        calculatedAt: "2026-08-31T10:00:00.000Z",
        overallScore: 70,
        scoreContext: { rawScoreBeforeContext: 60 } as ScoreSnapshotDTO["scoreContext"],
      }),
    ]);
    expect(points.map((p) => p.calculatedAt)).toEqual([
      "2026-08-31T10:00:00.000Z",
      "2026-09-02T10:00:00.000Z",
    ]);
    expect(points[0]).toMatchObject({ adjusted: 70, raw: 60 });
    expect(points[1]).toMatchObject({ adjusted: 90, raw: 88 });
  });

  it("keeps one point per snapshot and treats missing raw as a gap", () => {
    const points = mapScoreHistoryPoints([
      snapshot({
        overallScore: 80,
        scoreContext: { rawScoreBeforeContext: null } as ScoreSnapshotDTO["scoreContext"],
      }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]!.raw).toBeNull();
    expect(points[0]!.adjusted).toBe(80);
    expect(scoreHistoryTooltipHtml(points[0])).toContain("Unavailable");
    expect(scoreHistoryTooltipHtml(points[0])).toContain("80.0");
  });

  it("builds season markArea bands and null-safe series", () => {
    const points = mapScoreHistoryPoints([
      snapshot({ calculatedAt: "2026-08-01T00:00:00.000Z", seasonSlug: "season-1" }),
      snapshot({ calculatedAt: "2026-08-02T00:00:00.000Z", seasonSlug: "season-1" }),
      snapshot({ calculatedAt: "2026-09-01T00:00:00.000Z", seasonSlug: "season-2", overallScore: undefined }),
    ]);
    expect(scoreHistorySeasonBands(points)).toEqual([
      { from: 0, to: 1, seasonSlug: "season-1" },
      { from: 2, to: 2, seasonSlug: "season-2" },
    ]);
    const option = buildScoreHistoryChartOption(points) as {
      series: Array<{ data: Array<number | null>; markArea?: { data: unknown[] } }>;
    };
    expect(option.series[0]!.data).toEqual([80, 80, null]);
    expect(option.series[1]!.data).toEqual([70, 70, 70]);
    expect(option.series[0]!.markArea?.data).toHaveLength(2);
  });
});
