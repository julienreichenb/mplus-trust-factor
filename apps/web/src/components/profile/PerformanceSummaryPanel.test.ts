import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PerformanceSummaryPanel from "./PerformanceSummaryPanel.vue";
import type { PerformanceSummaryDTO } from "@mplus/contracts";

function summaryWithRuns(opts: {
  bestUrl: string | null;
  latestUrl?: string | null;
  sameRun?: boolean;
}): PerformanceSummaryDTO {
  const bestRun = {
    runId: "run-best",
    kind: "BEST" as const,
    dungeonSlug: "ara-kara",
    dungeonName: "Ara-Kara",
    keyLevel: 12,
    completedAt: "2026-01-15T12:00:00.000Z",
    timed: true,
    parsePercentile: 90,
    scoreValue: 200,
    wclUrl: opts.bestUrl,
  };
  const latestRun = opts.sameRun
    ? { ...bestRun, kind: "BOTH" as const }
    : {
        runId: "run-latest",
        kind: "LATEST" as const,
        dungeonSlug: "ara-kara",
        dungeonName: "Ara-Kara",
        keyLevel: 10,
        completedAt: "2026-01-20T12:00:00.000Z",
        timed: true,
        parsePercentile: 70,
        scoreValue: 150,
        wclUrl: opts.latestUrl ?? null,
      };

  return {
    currentSeason: {
      peakScore: 90,
      consistencyScore: 70,
      score: 83,
      confidence: 0.8,
      dungeonCount: 1,
      expectedDungeonCount: 8,
      latestObservedAt: "2026-01-20T12:00:00.000Z",
      dungeons: [
        {
          dungeonSlug: "ara-kara",
          dungeonName: "Ara-Kara",
          bestParsePercentile: 90,
          medianParsePercentile: 70,
          loggedRunCount: 4,
          bestRun,
          latestRun,
        },
      ],
    },
    historical: null,
  };
}

describe("PerformanceSummaryPanel selected run links", () => {
  it("renders numbered Warcraft Logs links with accessible labels and noopener", () => {
    const wrapper = mount(PerformanceSummaryPanel, {
      props: {
        summary: summaryWithRuns({
          bestUrl: "https://www.warcraftlogs.com/reports/ABC?fight=1",
          latestUrl: "https://warcraftlogs.com/reports/DEF?fight=2",
        }),
      },
    });

    const links = wrapper.findAll(".selected-runs__link");
    expect(links).toHaveLength(2);
    expect(links[0]!.text()).toBe("1");
    expect(links[1]!.text()).toBe("2");
    expect(links[0]!.attributes("href")).toBe("https://www.warcraftlogs.com/reports/ABC?fight=1");
    expect(links[0]!.attributes("target")).toBe("_blank");
    expect(links[0]!.attributes("rel")).toContain("noopener");
    expect(links[0]!.attributes("rel")).toContain("noreferrer");
    expect(links[0]!.attributes("aria-label")).toBe("Open selected Warcraft Logs run 1");
  });

  it("uses plain text for missing, non-HTTPS, unrelated, and deceptive hostnames", () => {
    for (const url of [
      null,
      "http://www.warcraftlogs.com/reports/ABC",
      "https://evil.example/reports/ABC",
      "https://warcraftlogs.com.attacker.example/x",
      "javascript:alert(1)",
    ]) {
      const wrapper = mount(PerformanceSummaryPanel, {
        props: { summary: summaryWithRuns({ bestUrl: url, sameRun: true }) },
      });
      expect(wrapper.find(".selected-runs__link").exists()).toBe(false);
      expect(wrapper.find(".selected-runs__plain").text()).toBe("1");
    }
  });
});

function roleAwareSummary(role: "DPS" | "TANK" | "HEALER"): PerformanceSummaryDTO {
  if (role === "HEALER") {
    return {
      currentSeason: {
        peakScore: 47,
        consistencyScore: 41.5,
        score: 73,
        confidence: 1,
        dungeonCount: 2,
        expectedDungeonCount: 3,
        latestObservedAt: null,
        dungeons: [
          {
            dungeonSlug: "algethar-academy",
            dungeonName: "Algeth'ar Academy",
            bestParsePercentile: 54,
            medianParsePercentile: 48,
            loggedRunCount: 26,
            bestRun: null,
            latestRun: null,
          },
        ],
      },
      historical: null,
      roleAware: {
        role: "HEALER",
        performanceScore: 73,
        weightsApplied: { damageParse: 0.45, healingParse: 0.55, cooldown: 0 },
        damage: {
          score: 60,
          confidence: 1,
          bestAverage: 47,
          medianAverage: 41.5,
          availableCells: 2,
          expectedCells: 3,
          dungeons: [
            {
              dungeonSlug: "magisters-terrace",
              dungeonName: "Magisters' Terrace",
              bestParsePercentile: 40,
              medianParsePercentile: 35,
              loggedRunCount: 10,
            },
            {
              dungeonSlug: "algethar-academy",
              dungeonName: "Algeth'ar Academy",
              bestParsePercentile: 54,
              medianParsePercentile: 48,
              loggedRunCount: 26,
            },
          ],
        },
        healing: {
          score: 80,
          confidence: 1,
          bestAverage: 80.33,
          medianAverage: 75.33,
          availableCells: 3,
          expectedCells: 3,
          dungeons: [
            {
              dungeonSlug: "algethar-academy",
              dungeonName: "Algeth'ar Academy",
              bestParsePercentile: 80,
              medianParsePercentile: 75,
              loggedRunCount: 26,
            },
            {
              dungeonSlug: "magisters-terrace",
              dungeonName: "Magisters' Terrace",
              bestParsePercentile: 91,
              medianParsePercentile: 86,
              loggedRunCount: 26,
            },
            {
              dungeonSlug: "skyreach",
              dungeonName: "Skyreach",
              bestParsePercentile: 70,
              medianParsePercentile: 65,
              loggedRunCount: 1,
            },
          ],
        },
      },
    };
  }

  return {
    currentSeason: {
      peakScore: 90,
      consistencyScore: 70,
      score: 83,
      confidence: 0.8,
      dungeonCount: 1,
      expectedDungeonCount: 8,
      latestObservedAt: null,
      dungeons: [],
    },
    historical: null,
    roleAware: {
      role,
      performanceScore: 83,
      weightsApplied: { damageParse: 1, healingParse: 0, cooldown: 0 },
      damage: {
        score: 83,
        confidence: 0.8,
        bestAverage: 90,
        medianAverage: 70,
        availableCells: 1,
        expectedCells: 8,
        dungeons: [
          {
            dungeonSlug: "ara-kara",
            dungeonName: "Ara-Kara",
            bestParsePercentile: 90,
            medianParsePercentile: 70,
            loggedRunCount: 4,
          },
        ],
      },
      healing: null,
    },
  };
}

describe("PerformanceSummaryPanel role-aware UI", () => {
  it("11. legacy snapshot without roleAware keeps legacy cards", () => {
    const wrapper = mount(PerformanceSummaryPanel, {
      props: { summary: summaryWithRuns({ bestUrl: null, sameRun: true }) },
    });
    expect(wrapper.text()).toContain("Peak");
    expect(wrapper.text()).toContain("Consistency");
    expect(wrapper.find('[data-testid="performance-summary-role-aware-cards"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="performance-summary-healer-table"]').exists()).toBe(false);
  });

  it("12. DPS table does not render Healing columns", () => {
    const wrapper = mount(PerformanceSummaryPanel, {
      props: { summary: roleAwareSummary("DPS") },
    });
    expect(wrapper.find('[data-testid="performance-summary-damage-table"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Healing");
    expect(wrapper.text()).toContain("Best avg");
    expect(wrapper.text()).not.toContain("Peak");
  });

  it("13. Healer table renders grouped Healing + Damage columns", () => {
    const wrapper = mount(PerformanceSummaryPanel, {
      props: { summary: roleAwareSummary("HEALER") },
    });
    expect(wrapper.find('[data-testid="performance-summary-healer-table"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Healing parse");
    expect(wrapper.text()).toContain("Damage parse");
    expect(wrapper.text()).toContain("Performance");
    expect(wrapper.text()).not.toContain("Peak");
    expect(wrapper.text()).not.toContain("Consistency");
  });

  it("14-16. healer rows merge by slug, show em dash for missing cells, independent colors", () => {
    const wrapper = mount(PerformanceSummaryPanel, {
      props: { summary: roleAwareSummary("HEALER") },
    });
    const rows = wrapper.findAll('[data-testid="performance-summary-healer-table"] tbody tr');
    expect(rows.length).toBe(3);
    const skyreach = rows.find((row) => row.text().includes("Skyreach"));
    expect(skyreach?.text()).toContain("70.0%");
    expect(skyreach?.text()).toContain("65.0%");
    expect((skyreach?.text().match(/—/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const magisters = rows.find((row) => row.text().includes("Magisters"));
    expect(magisters).toBeDefined();
    const pctClasses = magisters!
      .findAll(".parse-pct")
      .map((node) => node.classes().filter((cls) => cls.startsWith("parse-pct--")));
    expect(new Set(pctClasses.flat()).size).toBeGreaterThan(1);
  });
});
