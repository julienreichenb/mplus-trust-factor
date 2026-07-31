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
