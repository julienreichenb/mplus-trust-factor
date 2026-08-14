import { describe, expect, it } from "vitest";
import { ADMIN_SCORING_DEFAULT_REGION, adminScoringSeasonQuery } from "./adminScoringRegion";

describe("adminScoringRegion", () => {
  it("centralizes the EU-only scoring-season admin region", () => {
    expect(ADMIN_SCORING_DEFAULT_REGION).toBe("EU");
    expect(adminScoringSeasonQuery()).toBe("/api/v1/admin/misc/scoring-season?region=EU");
  });
});
