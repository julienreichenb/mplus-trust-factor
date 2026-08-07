import { describe, expect, it } from "vitest";
import type { RaiderIoCutoffThreshold, RaiderIoSeasonCutoffs } from "@mplus/contracts";
import {
  buildSeasonPopulationPolicy,
  estimatePreviousSeasonStanding,
  interpolateTopPercent,
  isMonotonicPopulationAnchors,
  type SeasonPopulationAnchor,
} from "./season-population-policy.js";

function threshold(
  score: number,
  quantile: RaiderIoCutoffThreshold["quantile"],
  label: RaiderIoCutoffThreshold["label"],
  extra?: Partial<RaiderIoCutoffThreshold>,
): RaiderIoCutoffThreshold {
  return { score, quantile, label, ...extra };
}

function cutoffs(partial: Partial<RaiderIoSeasonCutoffs> = {}): RaiderIoSeasonCutoffs {
  return {
    region: "EU",
    seasonSlug: "season-tww-3",
    updatedAt: "2026-03-01T00:00:00.000Z",
    top0_1Percent: null,
    top1Percent: null,
    top10Percent: null,
    top25Percent: null,
    top40Percent: null,
    attribution: {
      provider: "raiderio",
      displayText: "Data from Raider.IO",
      homepageUrl: "https://raider.io",
      profileUrl: null,
      sourceUrl: null,
    },
    ...partial,
  };
}

const COMPLETE = cutoffs({
  top0_1Percent: threshold(3400, "p999", "top_0_1_percent", {
    quantilePopulationCount: 100,
    totalPopulationCount: 100_000,
  }),
  top1Percent: threshold(3000, "p990", "top_1_percent", {
    quantilePopulationCount: 1000,
    totalPopulationCount: 100_000,
  }),
  top10Percent: threshold(2800, "p900", "top_10_percent", {
    quantilePopulationCount: 10_000,
    totalPopulationCount: 100_000,
  }),
  top25Percent: threshold(2500, "p750", "top_25_percent", {
    quantilePopulationCount: 25_000,
    totalPopulationCount: 100_000,
  }),
  top40Percent: threshold(2200, "p600", "top_40_percent", {
    quantilePopulationCount: 40_000,
    totalPopulationCount: 100_000,
  }),
});

describe("buildSeasonPopulationPolicy", () => {
  it("builds COMPLETE policy with five anchors ordered 0.1 → 40", () => {
    const result = buildSeasonPopulationPolicy(COMPLETE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policy.quality).toBe("COMPLETE");
    expect(result.policy.version).toBe("season-population-policy-v1");
    expect(result.policy.source).toBe("RAIDER_IO_SEASON_CUTOFFS");
    expect(result.policy.region).toBe("EU");
    expect(result.policy.seasonSlug).toBe("season-tww-3");
    expect(result.policy.sourceUpdatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(result.policy.anchors.map((a) => a.topPercent)).toEqual([0.1, 1, 10, 25, 40]);
    expect(result.policy.anchors.map((a) => a.key)).toEqual([
      "top_0_1_percent",
      "top_1_percent",
      "top_10_percent",
      "top_25_percent",
      "top_40_percent",
    ]);
  });

  it("builds PARTIAL policy with three valid anchors and no synthetic rows", () => {
    const result = buildSeasonPopulationPolicy(
      cutoffs({
        top1Percent: threshold(3000, "p990", "top_1_percent"),
        top25Percent: threshold(2500, "p750", "top_25_percent"),
        top40Percent: threshold(2200, "p600", "top_40_percent"),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policy.quality).toBe("PARTIAL");
    expect(result.policy.anchors).toHaveLength(3);
    expect(result.policy.anchors.map((a) => a.topPercent)).toEqual([1, 25, 40]);
  });

  it("marks INSUFFICIENT for zero or one valid anchor", () => {
    const zero = buildSeasonPopulationPolicy(cutoffs());
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.policy.quality).toBe("INSUFFICIENT");

    const one = buildSeasonPopulationPolicy(
      cutoffs({ top10Percent: threshold(2800, "p900", "top_10_percent") }),
    );
    expect(one.ok).toBe(true);
    if (one.ok) {
      expect(one.policy.quality).toBe("INSUFFICIENT");
      expect(one.policy.anchors).toHaveLength(1);
    }
  });

  it("rejects non-monotonic provider evidence without reordering scores", () => {
    const result = buildSeasonPopulationPolicy(
      cutoffs({
        top0_1Percent: threshold(3000, "p999", "top_0_1_percent"),
        top1Percent: threshold(3100, "p990", "top_1_percent"),
        top10Percent: threshold(2800, "p900", "top_10_percent"),
      }),
    );
    expect(result).toEqual({ ok: false, reason: "NON_MONOTONIC_THRESHOLDS" });
  });

  it("omits unusable scores (NaN, Infinity, negative)", () => {
    const result = buildSeasonPopulationPolicy(
      cutoffs({
        top0_1Percent: threshold(Number.NaN, "p999", "top_0_1_percent"),
        top1Percent: threshold(Number.POSITIVE_INFINITY, "p990", "top_1_percent"),
        top10Percent: threshold(-1, "p900", "top_10_percent"),
        top25Percent: threshold(2500, "p750", "top_25_percent"),
        top40Percent: threshold(2200, "p600", "top_40_percent"),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policy.quality).toBe("PARTIAL");
    expect(result.policy.anchors.map((a) => a.topPercent)).toEqual([25, 40]);
  });

  it("fails closed when seasonSlug is missing", () => {
    expect(buildSeasonPopulationPolicy(cutoffs({ seasonSlug: null }))).toEqual({
      ok: false,
      reason: "MISSING_SEASON_SLUG",
    });
    expect(buildSeasonPopulationPolicy(cutoffs({ seasonSlug: "  " }))).toEqual({
      ok: false,
      reason: "MISSING_SEASON_SLUG",
    });
  });

  it("accepts seasonSlug override when cutoffs.seasonSlug is null", () => {
    const result = buildSeasonPopulationPolicy(cutoffs({ seasonSlug: null, top1Percent: threshold(3000, "p990", "top_1_percent"), top40Percent: threshold(2200, "p600", "top_40_percent") }), {
      seasonSlug: "season-tww-2",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.policy.seasonSlug).toBe("season-tww-2");
  });

  it("preserves population count metadata unchanged", () => {
    const result = buildSeasonPopulationPolicy(COMPLETE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const top1 = result.policy.anchors.find((a) => a.key === "top_1_percent")!;
    expect(top1.quantilePopulationCount).toBe(1000);
    expect(top1.totalPopulationCount).toBe(100_000);
  });

  it("produces identical policy regardless of conceptual input field presence order", () => {
    const a = buildSeasonPopulationPolicy(COMPLETE);
    const shuffledLiteral = cutoffs({
      top40Percent: COMPLETE.top40Percent,
      top10Percent: COMPLETE.top10Percent,
      top0_1Percent: COMPLETE.top0_1Percent,
      top25Percent: COMPLETE.top25Percent,
      top1Percent: COMPLETE.top1Percent,
    });
    const b = buildSeasonPopulationPolicy(shuffledLiteral);
    expect(a).toEqual(b);
  });

  it("allows equal scores across anchors (monotonic equality)", () => {
    const result = buildSeasonPopulationPolicy(
      cutoffs({
        top1Percent: threshold(3000, "p990", "top_1_percent"),
        top10Percent: threshold(3000, "p900", "top_10_percent"),
        top25Percent: threshold(2500, "p750", "top_25_percent"),
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("estimatePreviousSeasonStanding", () => {
  const policy = (() => {
    const built = buildSeasonPopulationPolicy(COMPLETE);
    if (!built.ok) throw new Error("expected complete policy");
    return built.policy;
  })();

  it("maps all five exact thresholds", () => {
    const cases: Array<{ rating: number; topPercent: number; band: string }> = [
      { rating: 3400, topPercent: 0.1, band: "TOP_0_1_OR_BETTER" },
      { rating: 3000, topPercent: 1, band: "TOP_1" },
      { rating: 2800, topPercent: 10, band: "TOP_10" },
      { rating: 2500, topPercent: 25, band: "TOP_25" },
      { rating: 2200, topPercent: 40, band: "TOP_40" },
    ];
    for (const c of cases) {
      const result = estimatePreviousSeasonStanding(c.rating, policy);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.standing.method).toBe("EXACT_ANCHOR");
      expect(result.standing.estimatedTopPercent).toBe(c.topPercent);
      expect(result.standing.band).toBe(c.band);
    }
  });

  it("interpolates between adjacent complete-policy anchors", () => {
    // 0.1 ↔ 1: 3400 / 3000 → rating 3200 → t=0.5 → 0.55
    const a = estimatePreviousSeasonStanding(3200, policy);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.standing.method).toBe("INTERPOLATED");
      expect(a.standing.estimatedTopPercent).toBeCloseTo(0.55, 10);
      expect(a.standing.band).toBe("TOP_1");
    }

    // 1 ↔ 10: 3000 / 2800 → 2900 → t=0.5 → 5.5
    const b = estimatePreviousSeasonStanding(2900, policy);
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.standing.estimatedTopPercent).toBeCloseTo(5.5, 10);
      expect(b.standing.band).toBe("TOP_10");
    }

    // 10 ↔ 25: 2800 / 2500 → 2650 → t=0.5 → 17.5
    const c = estimatePreviousSeasonStanding(2650, policy);
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.standing.estimatedTopPercent).toBeCloseTo(17.5, 10);
      expect(c.standing.band).toBe("TOP_25");
    }

    // 25 ↔ 40: 2500 / 2200 → 2350 → t=0.5 → 32.5
    const d = estimatePreviousSeasonStanding(2350, policy);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.standing.estimatedTopPercent).toBeCloseTo(32.5, 10);
      expect(d.standing.band).toBe("TOP_40");
    }
  });

  it("interpolates across sparse missing intermediate anchors", () => {
    const built = buildSeasonPopulationPolicy(
      cutoffs({
        top1Percent: threshold(3000, "p990", "top_1_percent"),
        top25Percent: threshold(2500, "p750", "top_25_percent"),
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const result = estimatePreviousSeasonStanding(2750, built.policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.standing.method).toBe("INTERPOLATED");
    expect(result.standing.betterAnchor?.topPercent).toBe(1);
    expect(result.standing.worseAnchor?.topPercent).toBe(25);
    // t = (3000-2750)/(3000-2500) = 0.5 → 1 + 0.5*24 = 13
    expect(result.standing.estimatedTopPercent).toBeCloseTo(13, 10);
  });

  it("caps above strongest anchor without extrapolation", () => {
    const result = estimatePreviousSeasonStanding(3700, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.standing.method).toBe("CAPPED_AT_BEST_ANCHOR");
    expect(result.standing.estimatedTopPercent).toBe(0.1);
    expect(result.standing.band).toBe("TOP_0_1_OR_BETTER");
    expect(result.standing.worseAnchor).toBeNull();
  });

  it("returns null estimatedTopPercent below top40 with no extrapolation", () => {
    const result = estimatePreviousSeasonStanding(2000, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.standing.band).toBe("BELOW_TOP_40");
    expect(result.standing.estimatedTopPercent).toBeNull();
    expect(result.standing.method).toBe("BELOW_SUPPORTED_RANGE");
    expect(result.standing.worseAnchor?.topPercent).toBe(40);
  });

  it("uses BELOW_SUPPORTED_RANGE when below weakest partial anchor", () => {
    const built = buildSeasonPopulationPolicy(
      cutoffs({
        top1Percent: threshold(3000, "p990", "top_1_percent"),
        top25Percent: threshold(2500, "p750", "top_25_percent"),
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const result = estimatePreviousSeasonStanding(2000, built.policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.standing.band).toBe("BELOW_SUPPORTED_RANGE");
    expect(result.standing.estimatedTopPercent).toBeNull();
    expect(result.standing.method).toBe("BELOW_SUPPORTED_RANGE");
  });

  it("handles equal-score anchors without dividing by zero", () => {
    const built = buildSeasonPopulationPolicy(
      cutoffs({
        top1Percent: threshold(3000, "p990", "top_1_percent"),
        top10Percent: threshold(3000, "p900", "top_10_percent"),
        top25Percent: threshold(2500, "p750", "top_25_percent"),
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const exact = estimatePreviousSeasonStanding(3000, built.policy);
    expect(exact.ok).toBe(true);
    if (exact.ok) {
      // Stronger percentile wins on exact equal-score match.
      expect(exact.standing.method).toBe("EXACT_ANCHOR");
      expect(exact.standing.estimatedTopPercent).toBe(1);
      expect(exact.standing.band).toBe("TOP_1");
    }

    // Between plateau and next lower score: bracket skips zero-width to top25.
    const mid = estimatePreviousSeasonStanding(2750, built.policy);
    expect(mid.ok).toBe(true);
    if (mid.ok) {
      expect(mid.standing.method).toBe("INTERPOLATED");
      expect(mid.standing.betterAnchor?.topPercent).toBe(1);
      expect(mid.standing.worseAnchor?.topPercent).toBe(25);
      expect(mid.standing.estimatedTopPercent).toBeCloseTo(13, 10);
    }

    // Direct formula guard
    const plateau: SeasonPopulationAnchor = {
      key: "top_1_percent",
      topPercent: 1,
      score: 3000,
      quantilePopulationCount: null,
      totalPopulationCount: null,
    };
    const same: SeasonPopulationAnchor = {
      key: "top_10_percent",
      topPercent: 10,
      score: 3000,
      quantilePopulationCount: null,
      totalPopulationCount: null,
    };
    expect(interpolateTopPercent(3000, plateau, same)).toBe(1);
  });

  it("rejects invalid ratings", () => {
    for (const rating of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      expect(estimatePreviousSeasonStanding(rating, policy)).toEqual({
        ok: false,
        reason: "INVALID_RATING",
      });
    }
  });

  it("accepts rating 0 as a numeric floor (not inactivity semantics)", () => {
    const result = estimatePreviousSeasonStanding(0, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.standing.method).toBe("BELOW_SUPPORTED_RANGE");
    expect(result.standing.estimatedTopPercent).toBeNull();
  });

  it("fails closed on insufficient policy", () => {
    const built = buildSeasonPopulationPolicy(
      cutoffs({ top10Percent: threshold(2800, "p900", "top_10_percent") }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(estimatePreviousSeasonStanding(2800, built.policy)).toEqual({
      ok: false,
      reason: "INSUFFICIENT_POLICY",
    });
  });

  it("population metadata does not alter interpolation", () => {
    const withMeta = buildSeasonPopulationPolicy(COMPLETE);
    const withoutMeta = buildSeasonPopulationPolicy(
      cutoffs({
        top0_1Percent: threshold(3400, "p999", "top_0_1_percent"),
        top1Percent: threshold(3000, "p990", "top_1_percent"),
        top10Percent: threshold(2800, "p900", "top_10_percent"),
        top25Percent: threshold(2500, "p750", "top_25_percent"),
        top40Percent: threshold(2200, "p600", "top_40_percent"),
      }),
    );
    expect(withMeta.ok && withoutMeta.ok).toBe(true);
    if (!withMeta.ok || !withoutMeta.ok) return;
    const a = estimatePreviousSeasonStanding(2900, withMeta.policy);
    const b = estimatePreviousSeasonStanding(2900, withoutMeta.policy);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.standing.estimatedTopPercent).toBe(b.standing.estimatedTopPercent);
    expect(a.standing.method).toBe(b.standing.method);
    expect(a.standing.band).toBe(b.standing.band);
  });

  it("never claims TOP_0_1_OR_BETTER without meeting the top 0.1 threshold", () => {
    const justBelow = estimatePreviousSeasonStanding(3399.999, policy);
    expect(justBelow.ok).toBe(true);
    if (!justBelow.ok) return;
    expect(justBelow.standing.band).not.toBe("TOP_0_1_OR_BETTER");
    expect(justBelow.standing.band).toBe("TOP_1");
  });
});

describe("isMonotonicPopulationAnchors", () => {
  it("detects inversions among present anchors only", () => {
    const bad: SeasonPopulationAnchor[] = [
      {
        key: "top_0_1_percent",
        topPercent: 0.1,
        score: 3000,
        quantilePopulationCount: null,
        totalPopulationCount: null,
      },
      {
        key: "top_1_percent",
        topPercent: 1,
        score: 3100,
        quantilePopulationCount: null,
        totalPopulationCount: null,
      },
    ];
    expect(isMonotonicPopulationAnchors(bad)).toBe(false);
  });
});
