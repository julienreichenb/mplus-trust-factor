import { describe, expect, it } from "vitest";
import type { RaiderIoCutoffThreshold, RaiderIoSeasonCutoffs } from "@mplus/contracts";
import {
  buildSeasonPopulationPolicy,
  estimatePreviousSeasonStanding,
  isMonotonicPopulationAnchors,
  NATIVE_BAND_STANDING_SCORES,
  SEASON_POPULATION_POLICY_VERSION,
  upgradeSeasonPopulationPolicyV1ToV2,
  type SeasonPopulationAnchor,
  type SeasonPopulationPolicy,
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

/** Synthetic thresholds for band mapping examples (not real cutoffs). */
const SYNTHETIC = cutoffs({
  top0_1Percent: threshold(3500, "p999", "top_0_1_percent"),
  top1Percent: threshold(3200, "p990", "top_1_percent"),
  top10Percent: threshold(2800, "p900", "top_10_percent"),
  top25Percent: threshold(2500, "p750", "top_25_percent"),
  top40Percent: threshold(2200, "p600", "top_40_percent"),
});

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

function requirePolicy(cutoffsInput: RaiderIoSeasonCutoffs): SeasonPopulationPolicy {
  const built = buildSeasonPopulationPolicy(cutoffsInput);
  if (!built.ok) throw new Error(`expected policy: ${built.reason}`);
  return built.policy;
}

describe("buildSeasonPopulationPolicy", () => {
  it("builds COMPLETE policy with five native anchors ordered p999 → p600", () => {
    const result = buildSeasonPopulationPolicy(COMPLETE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policy.quality).toBe("COMPLETE");
    expect(result.policy.version).toBe(SEASON_POPULATION_POLICY_VERSION);
    expect(result.policy.version).toBe("season-population-policy-v2");
    expect(result.policy.anchors.map((a) => a.nativeQuantile)).toEqual([
      "p999",
      "p990",
      "p900",
      "p750",
      "p600",
    ]);
  });

  it("builds PARTIAL policy without inventing missing anchors", () => {
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
  });

  it("rejects non-monotonic thresholds", () => {
    const result = buildSeasonPopulationPolicy(
      cutoffs({
        top0_1Percent: threshold(3000, "p999", "top_0_1_percent"),
        top1Percent: threshold(3200, "p990", "top_1_percent"),
      }),
    );
    expect(result).toEqual({ ok: false, reason: "NON_MONOTONIC_THRESHOLDS" });
  });

  it("rejects missing season slug", () => {
    const result = buildSeasonPopulationPolicy(
      cutoffs({ seasonSlug: "", top0_1Percent: threshold(3500, "p999", "top_0_1_percent") }),
    );
    expect(result).toEqual({ ok: false, reason: "MISSING_SEASON_SLUG" });
  });
});

describe("isMonotonicPopulationAnchors", () => {
  it("allows equal adjacent scores", () => {
    const anchors: SeasonPopulationAnchor[] = [
      {
        key: "top_0_1_percent",
        topPercent: 0.1,
        nativeQuantile: "p999",
        score: 3000,
        quantilePopulationCount: null,
        totalPopulationCount: null,
      },
      {
        key: "top_1_percent",
        topPercent: 1,
        nativeQuantile: "p990",
        score: 3000,
        quantilePopulationCount: null,
        totalPopulationCount: null,
      },
    ];
    expect(isMonotonicPopulationAnchors(anchors)).toBe(true);
  });
});

describe("estimatePreviousSeasonStanding — complete native policy (A)", () => {
  const policy = requirePolicy(SYNTHETIC);

  it.each([
    { rating: 3600, band: "p999", score: 100 },
    { rating: 3500, band: "p999", score: 100 },
    { rating: 3499, band: "p990", score: 90 },
    { rating: 3200, band: "p990", score: 90 },
    { rating: 3199, band: "p900", score: 75 },
    { rating: 2800, band: "p900", score: 75 },
    { rating: 2799, band: "p750", score: 60 },
    { rating: 2500, band: "p750", score: 60 },
    { rating: 2499, band: "p600", score: 45 },
    { rating: 2200, band: "p600", score: 45 },
    { rating: 2199, band: "below_p600", score: 25 },
  ] as const)(
    "rating $rating → nativeBand $band standingScore $score",
    ({ rating, band, score }) => {
      const result = estimatePreviousSeasonStanding(rating, policy);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.standing.method).toBe("NATIVE_BAND");
      expect(result.standing.nativeBand).toBe(band);
      expect(result.standing.standingScore).toBe(score);
      expect(result.standing.estimatedTopPercent).toBeNull();
      expect(result.standing.standingScore).toBe(NATIVE_BAND_STANDING_SCORES[band]);
    },
  );
});

describe("estimatePreviousSeasonStanding — no interpolation (B)", () => {
  const policy = requirePolicy(COMPLETE);

  it("mid-band and near-threshold ratings share the same discrete score", () => {
    // Between p990 (3000) and p900 (2800) → always 75
    for (const rating of [2999, 2900, 2850, 2800]) {
      const result = estimatePreviousSeasonStanding(rating, policy);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.standing.standingScore).toBe(75);
      expect(result.standing.nativeBand).toBe("p900");
    }
    // Between p999 (3400) and p990 (3000) → always 90
    for (const rating of [3399, 3200, 3000]) {
      const result = estimatePreviousSeasonStanding(rating, policy);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.standing.standingScore).toBe(90);
    }
  });

  it("never returns interpolated mid-band scores like 82.5", () => {
    const result = estimatePreviousSeasonStanding(2900, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.standing.standingScore).toBe(75);
    expect(result.standing.standingScore).not.toBe(82.5);
  });
});

describe("estimatePreviousSeasonStanding — partial policies (C)", () => {
  it("unambiguous strongest band when only p999 is present", () => {
    const policy = requirePolicy(
      cutoffs({ top0_1Percent: threshold(3500, "p999", "top_0_1_percent") }),
    );
    const result = estimatePreviousSeasonStanding(3600, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.standing.standingScore).toBe(100);
    expect(result.standing.nativeBand).toBe("p999");
  });

  it("unambiguous below_p600 when only p600 is present", () => {
    const policy = requirePolicy(
      cutoffs({ top40Percent: threshold(2200, "p600", "top_40_percent") }),
    );
    const result = estimatePreviousSeasonStanding(2100, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.standing.standingScore).toBe(25);
    expect(result.standing.nativeBand).toBe("below_p600");
  });

  it("missing upper discriminator → unavailable", () => {
    const policy = requirePolicy(
      cutoffs({
        top1Percent: threshold(3200, "p990", "top_1_percent"),
        top10Percent: threshold(2800, "p900", "top_10_percent"),
      }),
    );
    expect(estimatePreviousSeasonStanding(3300, policy)).toEqual({
      ok: false,
      reason: "AMBIGUOUS_PARTIAL_POLICY",
    });
  });

  it("missing middle discriminator → unavailable", () => {
    const policy = requirePolicy(
      cutoffs({
        top0_1Percent: threshold(3500, "p999", "top_0_1_percent"),
        top10Percent: threshold(2800, "p900", "top_10_percent"),
        top40Percent: threshold(2200, "p600", "top_40_percent"),
      }),
    );
    expect(estimatePreviousSeasonStanding(3000, policy)).toEqual({
      ok: false,
      reason: "AMBIGUOUS_PARTIAL_POLICY",
    });
  });

  it("missing irrelevant weaker boundary still classifies a stronger band", () => {
    const policy = requirePolicy(
      cutoffs({
        top0_1Percent: threshold(3500, "p999", "top_0_1_percent"),
        top1Percent: threshold(3200, "p990", "top_1_percent"),
        top10Percent: threshold(2800, "p900", "top_10_percent"),
        // missing p750 and p600 — still provable for rating in p900 band
      }),
    );
    const result = estimatePreviousSeasonStanding(2900, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.standing.standingScore).toBe(75);
    expect(result.standing.nativeBand).toBe("p900");
  });
});

describe("estimatePreviousSeasonStanding — invalid policies (D)", () => {
  it("non-monotonic policy fails closed", () => {
    const policy: SeasonPopulationPolicy = {
      version: SEASON_POPULATION_POLICY_VERSION,
      source: "RAIDER_IO_SEASON_CUTOFFS",
      region: "EU",
      seasonSlug: "season-tww-3",
      sourceUpdatedAt: null,
      quality: "PARTIAL",
      anchors: [
        {
          key: "top_0_1_percent",
          topPercent: 0.1,
          nativeQuantile: "p999",
          score: 3000,
          quantilePopulationCount: null,
          totalPopulationCount: null,
        },
        {
          key: "top_1_percent",
          topPercent: 1,
          nativeQuantile: "p990",
          score: 3200,
          quantilePopulationCount: null,
          totalPopulationCount: null,
        },
      ],
    };
    expect(estimatePreviousSeasonStanding(3100, policy)).toEqual({
      ok: false,
      reason: "NON_MONOTONIC_POLICY",
    });
  });

  it("incompatible policy version fails closed", () => {
    const policy = {
      ...requirePolicy(COMPLETE),
      version: "season-population-policy-v1",
    } as SeasonPopulationPolicy;
    expect(estimatePreviousSeasonStanding(2900, policy)).toEqual({
      ok: false,
      reason: "INCOMPATIBLE_POLICY_VERSION",
    });
  });

  it("empty anchors → insufficient", () => {
    const policy: SeasonPopulationPolicy = {
      version: SEASON_POPULATION_POLICY_VERSION,
      source: "RAIDER_IO_SEASON_CUTOFFS",
      region: "EU",
      seasonSlug: "season-tww-3",
      sourceUpdatedAt: null,
      quality: "INSUFFICIENT",
      anchors: [],
    };
    expect(estimatePreviousSeasonStanding(2900, policy)).toEqual({
      ok: false,
      reason: "INSUFFICIENT_POLICY",
    });
  });

  it("invalid rating fails closed", () => {
    const policy = requirePolicy(COMPLETE);
    expect(estimatePreviousSeasonStanding(-1, policy)).toEqual({
      ok: false,
      reason: "INVALID_RATING",
    });
  });
});

describe("upgradeSeasonPopulationPolicyV1ToV2", () => {
  it("upgrades canonical v1 anchors without provider calls", () => {
    const v1 = {
      version: "season-population-policy-v1",
      source: "RAIDER_IO_SEASON_CUTOFFS",
      region: "EU",
      seasonSlug: "season-tww-3",
      sourceUpdatedAt: "2026-03-01T00:00:00.000Z",
      quality: "COMPLETE",
      anchors: [
        {
          key: "top_0_1_percent",
          topPercent: 0.1,
          score: 3400,
          quantilePopulationCount: null,
          totalPopulationCount: null,
        },
        {
          key: "top_1_percent",
          topPercent: 1,
          score: 3000,
          quantilePopulationCount: null,
          totalPopulationCount: null,
        },
        {
          key: "top_10_percent",
          topPercent: 10,
          score: 2800,
          quantilePopulationCount: null,
          totalPopulationCount: null,
        },
        {
          key: "top_25_percent",
          topPercent: 25,
          score: 2500,
          quantilePopulationCount: null,
          totalPopulationCount: null,
        },
        {
          key: "top_40_percent",
          topPercent: 40,
          score: 2200,
          quantilePopulationCount: null,
          totalPopulationCount: null,
        },
      ],
    };
    const upgraded = upgradeSeasonPopulationPolicyV1ToV2(v1);
    expect(upgraded).not.toBeNull();
    expect(upgraded!.version).toBe(SEASON_POPULATION_POLICY_VERSION);
    expect(upgraded!.anchors.map((a) => a.nativeQuantile)).toEqual([
      "p999",
      "p990",
      "p900",
      "p750",
      "p600",
    ]);
    const standing = estimatePreviousSeasonStanding(2900, upgraded!);
    expect(standing.ok).toBe(true);
    if (!standing.ok) return;
    expect(standing.standing.standingScore).toBe(75);
  });

  it("rejects non-canonical topPercent on v1 anchors", () => {
    expect(
      upgradeSeasonPopulationPolicyV1ToV2({
        version: "season-population-policy-v1",
        source: "RAIDER_IO_SEASON_CUTOFFS",
        region: "EU",
        seasonSlug: "season-tww-3",
        sourceUpdatedAt: null,
        quality: "INSUFFICIENT",
        anchors: [
          {
            key: "top_1_percent",
            topPercent: 2,
            score: 3000,
            quantilePopulationCount: null,
            totalPopulationCount: null,
          },
        ],
      }),
    ).toBeNull();
  });
});
