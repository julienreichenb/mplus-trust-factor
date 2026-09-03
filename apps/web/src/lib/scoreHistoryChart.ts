import type { ScoreSnapshotDTO } from "@mplus/contracts";
import { formatScore } from "./format";

export interface ScoreHistoryPoint {
  id: string;
  calculatedAt: string;
  seasonSlug: string;
  adjusted: number | null;
  raw: number | null;
}

export interface ScoreHistorySeasonBand {
  from: number;
  to: number;
  seasonSlug: string;
}

const SEASON_BAND_COLORS = [
  "rgba(245, 158, 11, 0.12)",
  "rgba(56, 189, 248, 0.10)",
  "rgba(167, 139, 250, 0.10)",
  "rgba(34, 197, 94, 0.10)",
  "rgba(251, 113, 133, 0.10)",
];

export function seasonLabel(slug: string): string {
  const blizzard = slug.match(/blizzard-season-(\d+)/i);
  if (blizzard) return `Season ${blizzard[1]}`;
  const numbered = slug.match(/season[-_]?(\d+)/i);
  if (numbered) return `Season ${numbered[1]}`;
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatHistoryDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Invalid date";
  return d.toLocaleString();
}

function readRawScore(snapshot: ScoreSnapshotDTO): number | null {
  const rawTopLevel = (snapshot as { scoreContext?: { rawScoreBeforeContext?: unknown } })
    .scoreContext?.rawScoreBeforeContext;
  const rawFromExplanation = (
    snapshot as {
      explanation?: { scoreContext?: { rawScoreBeforeContext?: unknown } } | null;
    }
  ).explanation?.scoreContext?.rawScoreBeforeContext;
  if (typeof rawTopLevel === "number" && Number.isFinite(rawTopLevel)) return rawTopLevel;
  if (typeof rawFromExplanation === "number" && Number.isFinite(rawFromExplanation)) {
    return rawFromExplanation;
  }
  return null;
}

export function mapScoreHistoryPoints(snapshots: ScoreSnapshotDTO[]): ScoreHistoryPoint[] {
  return snapshots
    .slice()
    .sort((a, b) => new Date(a.calculatedAt).getTime() - new Date(b.calculatedAt).getTime())
    .map((s) => {
      const adjusted =
        typeof s.overallScore === "number" && Number.isFinite(s.overallScore) ? s.overallScore : null;
      return {
        id: s.calculatedAt + "|" + s.seasonSlug + "|" + s.modelKey,
        calculatedAt: s.calculatedAt,
        seasonSlug: s.seasonSlug,
        adjusted,
        raw: readRawScore(s),
      };
    });
}

export function scoreHistorySeasonBands(points: ScoreHistoryPoint[]): ScoreHistorySeasonBand[] {
  const bands: ScoreHistorySeasonBand[] = [];
  for (let i = 0; i < points.length; ) {
    const slug = points[i]!.seasonSlug;
    let j = i;
    while (j + 1 < points.length && points[j + 1]!.seasonSlug === slug) j++;
    bands.push({ from: i, to: j, seasonSlug: slug });
    i = j + 1;
  }
  return bands;
}

export function scoreHistoryTooltipHtml(point: ScoreHistoryPoint | undefined): string {
  if (!point) return "";
  const raw = point.raw != null ? formatScore(point.raw, 1) : "Unavailable";
  const adjusted = point.adjusted != null ? formatScore(point.adjusted, 1) : "Unavailable";
  return [
    `<strong>Calculated</strong> ${formatHistoryDateTime(point.calculatedAt)}`,
    `<strong>Raw</strong> ${raw}`,
    `<strong>Trust Score</strong> ${adjusted}`,
    `<strong>Season</strong> ${seasonLabel(point.seasonSlug)}`,
  ].join("<br/>");
}

export function buildScoreHistoryChartOption(points: ScoreHistoryPoint[]): Record<string, unknown> {
  const categories = points.map((p) => p.calculatedAt);
  const bands = scoreHistorySeasonBands(points);
  const markAreaData = bands.map((band, index) => [
    {
      xAxis: categories[band.from],
      itemStyle: { color: SEASON_BAND_COLORS[index % SEASON_BAND_COLORS.length] },
      name: seasonLabel(band.seasonSlug),
    },
    { xAxis: categories[band.to] },
  ]);

  return {
    animation: false,
    grid: { left: 48, right: 16, top: 28, bottom: 36 },
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const first = Array.isArray(params) ? params[0] : params;
        const idx =
          first && typeof first === "object" && "dataIndex" in first
            ? Number((first as { dataIndex?: number }).dataIndex)
            : 0;
        return scoreHistoryTooltipHtml(points[idx]);
      },
    },
    legend: {
      data: ["Trust Score", "Raw score"],
      top: 0,
      textStyle: { color: "#9aa3b2", fontSize: 12 },
    },
    xAxis: {
      type: "category",
      data: categories,
      boundaryGap: points.length <= 1,
      axisLabel: {
        color: "#9aa3b2",
        formatter: (value: string) => {
          const d = new Date(value);
          if (Number.isNaN(d.getTime())) return "";
          return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        },
      },
      axisLine: { lineStyle: { color: "#34343A" } },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      interval: 25,
      axisLabel: { color: "#9aa3b2" },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.14)" } },
    },
    series: [
      {
        name: "Trust Score",
        type: "line",
        data: points.map((p) => p.adjusted),
        connectNulls: false,
        showSymbol: true,
        symbolSize: 8,
        lineStyle: { width: 2.25, color: "#F59E0B" },
        itemStyle: { color: "#F59E0B" },
        areaStyle: { color: "rgba(245, 158, 11, 0.18)" },
        markArea: {
          silent: true,
          data: markAreaData,
        },
      },
      {
        name: "Raw score",
        type: "line",
        data: points.map((p) => p.raw),
        connectNulls: false,
        showSymbol: true,
        symbolSize: 6,
        lineStyle: { width: 1.75, type: "dashed", color: "rgba(148, 163, 184, 0.9)" },
        itemStyle: { color: "rgba(148, 163, 184, 0.95)" },
      },
    ],
  };
}
