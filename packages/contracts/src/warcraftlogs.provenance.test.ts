import { describe, expect, it } from "vitest";
import {
  deriveWclContributionTypes,
  normalizeWclProvenance,
  refineWclDataState,
} from "./warcraftlogs.js";

describe("WCL provenance contract", () => {
  it("never treats NO_MATCHED_RUN as visibility", () => {
    expect(normalizeWclProvenance("NO_MATCHED_RUN")).toEqual({
      visibility: "PUBLIC",
      dataState: "NO_MATCHED_RUN",
    });
  });

  it("maps HIDDEN only for explicit hidden visibility", () => {
    expect(normalizeWclProvenance("HIDDEN")).toEqual({
      visibility: "HIDDEN",
      dataState: "NO_PUBLIC_LOGS",
    });
  });

  it("keeps PUBLIC when refining zero newly matched runs with rankings", () => {
    const refined = refineWclDataState({
      visibility: "PUBLIC",
      baseDataState: "NO_MATCHED_RUN",
      combatFactsCount: 0,
      dungeonAggregateCount: 8,
    });
    expect(refined).toBe("RANKINGS_ONLY");
  });

  it("promotes to MATCHED_COMBAT_LOGS from deferred digests without combatFacts", () => {
    const refined = refineWclDataState({
      visibility: "PUBLIC",
      baseDataState: "RANKINGS_ONLY",
      combatFactsCount: 0,
      dungeonAggregateCount: 8,
      detailedEvidenceCount: 8,
    });
    expect(refined).toBe("MATCHED_COMBAT_LOGS");
  });

  it("keeps PUBLIC visibility when combat matches drop to zero", () => {
    const refined = refineWclDataState({
      visibility: "PUBLIC",
      baseDataState: "MATCHED_COMBAT_LOGS",
      combatFactsCount: 0,
      dungeonAggregateCount: 0,
    });
    expect(refined).toBe("NO_MATCHED_RUN");
  });

  it("derives contribution types from zone rankings, survival, and combat facts", () => {
    expect(
      deriveWclContributionTypes([
        {
          sourceProvider: "warcraftlogs",
          metricKey: "performance.current_season_peak",
          context: { derivedFrom: "wcl_zone_rankings_best_parse" },
        },
        {
          sourceProvider: "warcraftlogs",
          metricKey: "survival.defensive_response",
          context: { derivedFrom: "combat_facts" },
        },
        {
          sourceProvider: "warcraftlogs",
          metricKey: "utility.interrupt_success",
          context: { derivedFrom: "combat_facts" },
        },
      ]),
    ).toEqual(["PERFORMANCE", "ZONE_RANKINGS", "SURVIVAL", "COMBAT_EVENTS", "COMBAT_FACTS"]);
  });
});
