import { describe, expect, it } from "vitest";
import {
  EXPERIENCE_KEY_BANDS,
  KEY_BAND_COUNT,
  PRIOR_SEASON_RIO_DEPTH,
  PRIOR_SEASON_LOCAL_CAP,
  computeExperienceV2,
  distinctKeyBands,
  historicalSeasonsNormalized,
  mergePriorSeasonCount,
  resolvePriorSeasonSourceDepth,
} from "../../index.js";

const NOW = "2026-07-29T12:00:00.000Z";
const RECENT = "2026-07-20T12:00:00.000Z";

describe("Experience V2 key_band_breadth", () => {
  it("defines exactly 6 bands and uses that count as the denominator", () => {
    expect(EXPERIENCE_KEY_BANDS).toHaveLength(6);
    expect(KEY_BAND_COUNT).toBe(6);
    expect(KEY_BAND_COUNT).toBe(EXPERIENCE_KEY_BANDS.length);
  });

  it("covers boundary counts 0 through all 6 bands without exceeding 100", () => {
    const bandKeys = [3, 6, 8, 10, 13, 15];
    for (let n = 0; n <= KEY_BAND_COUNT; n++) {
      const selectedRuns = bandKeys.slice(0, n).map((keyLevel, i) => ({
        dungeonSlug: `d-${i}`,
        keyLevel,
        completedAt: RECENT,
      }));
      const result = computeExperienceV2({
        expectedDungeonCount: 8,
        selectedRuns,
        seasonRuns: selectedRuns,
        priorSeasonCount: 0,
        priorSeasonSourceDepth: PRIOR_SEASON_RIO_DEPTH,
        observedAt: NOW,
        provenance: selectedRuns.length > 0 ? "HAS_HISTORY" : "CONFIRMED_ABSENCE",
      });
      const band = result.components.find((c) => c.metricKey === "experience.key_band_breadth")!;
      expect(band.rawValue).toBe(n);
      expect(distinctKeyBands(selectedRuns)).toHaveLength(n);
      expect(band.normalizedValue).toBeCloseTo((n / KEY_BAND_COUNT) * 100, 8);
      expect(band.normalizedValue).toBeGreaterThanOrEqual(0);
      expect(band.normalizedValue).toBeLessThanOrEqual(100);
    }
  });

  it("never exceeds 100 even if more than 6 band labels were somehow counted", () => {
    expect(historicalSeasonsNormalized(99, 6)).toBe(100);
    const overflow = computeExperienceV2({
      expectedDungeonCount: 8,
      selectedRuns: [
        { dungeonSlug: "a", keyLevel: 2, completedAt: RECENT },
        { dungeonSlug: "b", keyLevel: 5, completedAt: RECENT },
        { dungeonSlug: "c", keyLevel: 8, completedAt: RECENT },
        { dungeonSlug: "d", keyLevel: 10, completedAt: RECENT },
        { dungeonSlug: "e", keyLevel: 12, completedAt: RECENT },
        { dungeonSlug: "f", keyLevel: 15, completedAt: RECENT },
        { dungeonSlug: "g", keyLevel: 16, completedAt: RECENT },
      ],
      seasonRuns: [],
      priorSeasonCount: 0,
      observedAt: NOW,
      provenance: "HAS_HISTORY",
    });
    const band = overflow.components.find((c) => c.metricKey === "experience.key_band_breadth")!;
    expect(band.rawValue).toBe(6);
    expect(band.normalizedValue).toBe(100);
  });
});

describe("Experience V2 historical_seasons source depth", () => {
  it("RIO-only path uses depth 1 so previous season can reach 100", () => {
    expect(PRIOR_SEASON_RIO_DEPTH).toBe(1);
    expect(resolvePriorSeasonSourceDepth({ rioPriorSeasonCount: 1, localPriorSeasonCount: 0 })).toBe(
      1,
    );
    expect(historicalSeasonsNormalized(1, 1)).toBe(100);
    expect(historicalSeasonsNormalized(1, 3)).toBeCloseTo(100 / 3, 5); // documents the bad case we avoid
  });

  it("merges RIO previous with durable local prior seasons up to local cap", () => {
    expect(mergePriorSeasonCount(1, 0)).toBe(1);
    expect(mergePriorSeasonCount(0, 2)).toBe(2);
    expect(mergePriorSeasonCount(1, 3)).toBe(PRIOR_SEASON_LOCAL_CAP);
    expect(mergePriorSeasonCount(1, 9)).toBe(PRIOR_SEASON_LOCAL_CAP);
  });

  it("local prior seasons raise source depth so max observable is 100", () => {
    expect(resolvePriorSeasonSourceDepth({ rioPriorSeasonCount: 1, localPriorSeasonCount: 2 })).toBe(
      2,
    );
    expect(resolvePriorSeasonSourceDepth({ rioPriorSeasonCount: 0, localPriorSeasonCount: 3 })).toBe(
      3,
    );
    const result = computeExperienceV2({
      expectedDungeonCount: 8,
      selectedRuns: [{ dungeonSlug: "a", keyLevel: 10, completedAt: RECENT }],
      seasonRuns: [{ dungeonSlug: "a", keyLevel: 10, completedAt: RECENT }],
      priorSeasonCount: 2,
      priorSeasonSourceDepth: 2,
      observedAt: NOW,
      provenance: "HAS_HISTORY",
    });
    const hist = result.components.find((c) => c.metricKey === "experience.historical_seasons")!;
    expect(hist.normalizedValue).toBe(100);
    expect(hist.detail.priorSeasonSourceDepth).toBe(2);
    expect(hist.detail.rioFieldDepth).toBe(1);
  });
});
