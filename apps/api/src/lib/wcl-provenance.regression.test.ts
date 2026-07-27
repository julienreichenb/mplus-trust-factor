import { describe, expect, it } from "vitest";
import { refineWclDataState, normalizeWclProvenance } from "@mplus/contracts";

/**
 * Regression: refresh 1 PUBLIC with matched runs → refresh 2 PUBLIC with zero newly
 * matched runs must keep visibility PUBLIC and move dataState to NO_MATCHED_RUN/RANKINGS_ONLY.
 */
describe("WCL visibility vs matching regression", () => {
  it("keeps PUBLIC visibility across a second refresh with zero new matches", () => {
    const first = refineWclDataState({
      visibility: "PUBLIC",
      baseDataState: "NO_MATCHED_RUN",
      combatFactsCount: 2,
      dungeonAggregateCount: 8,
    });
    expect(first).toBe("MATCHED_COMBAT_LOGS");

    const second = refineWclDataState({
      visibility: "PUBLIC",
      baseDataState: first,
      combatFactsCount: 0,
      dungeonAggregateCount: 8,
    });
    expect(second).toBe("RANKINGS_ONLY");

    const secondNoRankings = refineWclDataState({
      visibility: "PUBLIC",
      baseDataState: first,
      combatFactsCount: 0,
      dungeonAggregateCount: 0,
    });
    expect(secondNoRankings).toBe("NO_MATCHED_RUN");

    // Legacy persisted NO_MATCHED_RUN must never become visibility.
    expect(normalizeWclProvenance("NO_MATCHED_RUN")).toEqual({
      visibility: "PUBLIC",
      dataState: "NO_MATCHED_RUN",
    });
  });
});
