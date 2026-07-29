import { describe, expect, it } from "vitest";
import { planDatasetRefresh, resolveRefreshSemantics } from "./dataset-refresh-planner.js";
import { buildFreshnessConfig } from "@mplus/config";

describe("dataset refresh planner", () => {
  it("plans rating-only when combat evidence is fresh", () => {
    const plan = planDatasetRefresh({
      reason: "scheduled_refresh",
      ratingStaleCombatFresh: true,
    });
    expect(plan.mode).toBe("RATING_ONLY");
    expect(plan.datasetsToReuse).toContain("wcl.combat_events");
  });

  it("plans partial report refresh for changed revisions", () => {
    const plan = planDatasetRefresh({
      reason: "scheduled_refresh",
      changedReportCodes: ["ABC", "DEF"],
    });
    expect(plan.mode).toBe("PARTIAL_REPORT_REFRESH");
    expect(plan.estimatedWclOperations.length).toBeGreaterThan(0);
  });

  it("skips when all datasets are fresh", () => {
    const freshnessConfig = buildFreshnessConfig({
      BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
      WCL_CHARACTER_TTL_SECONDS: 43_200,
      RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
    });
    const plan = planDatasetRefresh({
      reason: "scheduled_refresh",
      immutableHistoryValid: true,
      freshnessConfig,
      datasetStates: [
        { dataset: "wcl.combat_events", fetchedAt: new Date() },
        { dataset: "blizzard.character_profile", fetchedAt: new Date() },
      ],
    });
    expect(plan.mode).toBe("SKIP_ALREADY_FRESH");
    expect(plan.providerCallsRequired).toBe(false);
  });

  it("owner refresh respects cooldown and WCL safety", () => {
    const semantics = resolveRefreshSemantics("owner_refresh");
    expect(semantics.allowCooldownBypass).toBe(false);
    expect(semantics.respectGlobalWclSafety).toBe(true);
  });
});
