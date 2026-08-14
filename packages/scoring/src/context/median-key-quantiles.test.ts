import { describe, expect, it } from "vitest";
import {
  characterMedianOfEightLevels,
  empiricalCdfQuantile,
  isCompleteEightDungeonLevels,
  pointsFromHistogram,
} from "./median-key-quantiles.js";

describe("empiricalCdfQuantile", () => {
  it("returns the minimum observed value whose CDF reaches P (no interpolation)", () => {
    const hist = new Map([
      [10, 40],
      [12, 30],
      [14, 20],
      [16, 10],
    ]);
    expect(empiricalCdfQuantile(hist, 6000)).toBe(12);
    expect(empiricalCdfQuantile(hist, 7500)).toBe(14);
    expect(empiricalCdfQuantile(hist, 9000)).toBe(14);
    expect(empiricalCdfQuantile(hist, 9900)).toBe(16);
    expect(empiricalCdfQuantile(hist, 9990)).toBe(16);
  });

  it("preserves .5 observed medians", () => {
    const hist = new Map([
      [12, 1],
      [12.5, 8],
      [13, 1],
    ]);
    expect(empiricalCdfQuantile(hist, 5000)).toBe(12.5);
    expect(empiricalCdfQuantile(hist, 9000)).toBe(12.5);
  });

  it("is independent of insertion order", () => {
    const a = new Map([
      [16, 2],
      [10, 5],
      [12, 3],
    ]);
    const b = new Map([
      [10, 5],
      [12, 3],
      [16, 2],
    ]);
    expect(empiricalCdfQuantile(a, 7500)).toBe(empiricalCdfQuantile(b, 7500));
  });

  it("matches an expanded-array reference implementation", () => {
    const hist = new Map([
      [11, 3],
      [12.5, 4],
      [14, 3],
    ]);
    const expanded: number[] = [];
    for (const [v, n] of hist) {
      for (let i = 0; i < n; i++) expanded.push(v);
    }
    expanded.sort((x, y) => x - y);
    const n = expanded.length;
    function ref(pBps: number): number {
      const target = (pBps / 10_000) * n;
      let cum = 0;
      for (const v of [...new Set(expanded)].sort((x, y) => x - y)) {
        cum += expanded.filter((x) => x === v).length;
        if (cum >= target) return v;
      }
      return expanded[expanded.length - 1]!;
    }
    for (const p of [6000, 7500, 9000, 9900, 9990]) {
      expect(empiricalCdfQuantile(hist, p)).toBe(ref(p));
    }
  });
});

describe("characterMedianOfEightLevels", () => {
  it("averages 0-based indexes 3 and 4", () => {
    expect(characterMedianOfEightLevels([20, 10, 12, 14, 11, 13, 15, 16])).toBe(13.5);
    expect(characterMedianOfEightLevels([12, 12, 12, 13, 13, 13, 13, 14])).toBe(13);
  });
});

describe("isCompleteEightDungeonLevels", () => {
  it("excludes any zero or short list", () => {
    expect(isCompleteEightDungeonLevels([1, 2, 3, 4, 5, 6, 7, 8])).toBe(true);
    expect(isCompleteEightDungeonLevels([1, 2, 3, 4, 5, 6, 7, 0])).toBe(false);
    expect(isCompleteEightDungeonLevels([1, 2, 3, 4, 5, 6, 7])).toBe(false);
  });
});

describe("pointsFromHistogram", () => {
  it("emits the locked Key Context percentile set", () => {
    const points = pointsFromHistogram(new Map([[10, 1], [20, 1]]));
    expect(points.map((p) => p.percentileBps)).toEqual([6000, 7500, 9000, 9900, 9990]);
  });
});
