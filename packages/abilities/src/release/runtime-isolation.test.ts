import { describe, expect, it } from "vitest";
import {
  CURRENT_CATALOG_VERSION_ID,
  getAllRegisteredRules,
  RETAIL_ABILITY_CATALOG,
} from "../index.js";

describe("Phase 3B.1 runtime isolation", () => {
  it("keeps RETAIL_ABILITY_CATALOG as runtime authority with unchanged version", () => {
    expect(RETAIL_ABILITY_CATALOG.catalogVersion).toBe(CURRENT_CATALOG_VERSION_ID);
    expect(CURRENT_CATALOG_VERSION_ID).toBe("12.0.0/midnight-season-1");
    expect(getAllRegisteredRules()).toHaveLength(311);
    expect(RETAIL_ABILITY_CATALOG.rules).toHaveLength(311);
  });

  it("does not export release activation or DB catalog load from package root", async () => {
    const mod = await import("../index.js");
    expect("activateAbilityCatalogRelease" in mod).toBe(false);
    expect("loadAbilityCatalogFromCas" in mod).toBe(false);
    expect("publishAbilityCatalogRelease" in mod).toBe(false);
  });
});
