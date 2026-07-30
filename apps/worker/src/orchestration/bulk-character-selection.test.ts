import { describe, expect, it } from "vitest";
import {
  ESTIMATED_WCL_CALLS_PER_FULL_REFRESH,
  buildBulkLogicalKey,
  filterByMythicPlusThreshold,
  selectBulkCharacters,
  type BulkSelectableCharacter,
} from "./bulk-character-selection.js";

const chars: BulkSelectableCharacter[] = [
  {
    characterId: "a",
    region: "EU",
    realmSlug: "tarren-mill",
    name: "Alpha",
    mythicPlusScore: 3000,
    hasCompatibleEvidence: true,
  },
  {
    characterId: "b",
    region: "EU",
    realmSlug: "tarren-mill",
    name: "Beta",
    mythicPlusScore: 2500,
    hasCompatibleEvidence: false,
  },
  {
    characterId: "c",
    region: "US",
    realmSlug: "area-52",
    name: "Charlie",
    mythicPlusScore: null,
    hasCompatibleEvidence: true,
  },
  {
    characterId: "d",
    region: "EU",
    realmSlug: "twisting-nether",
    name: "Delta",
    mythicPlusScore: 2800,
    hasCompatibleEvidence: true,
  },
];

describe("bulk character selection", () => {
  it("keeps characters at or above a numeric threshold", () => {
    const filtered = filterByMythicPlusThreshold(chars, 2800);
    expect(filtered.map((c) => c.characterId).sort()).toEqual(["a", "d"]);
  });

  it("selects all persisted characters when threshold is null", () => {
    const filtered = filterByMythicPlusThreshold(chars, null);
    expect(filtered).toHaveLength(4);
  });

  it("reports incompatible recalculate-only evidence without converting by default", () => {
    const result = selectBulkCharacters({
      mode: "RECALCULATE_ONLY",
      minMythicPlusScore: 2500,
      characters: chars,
    });
    const incompatible = result.items.find((i) => i.characterId === "b");
    expect(incompatible?.disposition).toBe("SKIP_INCOMPATIBLE");
    expect(incompatible?.skipReason).toBe("INCOMPATIBLE_OR_MISSING_EVIDENCE");
    expect(result.estimatedWclCalls).toBe(0);
    expect(result.estimatedChildJobs).toBe(2);
  });

  it("propagates explicit incompatibility reasons", () => {
    const result = selectBulkCharacters({
      mode: "RECALCULATE_ONLY",
      minMythicPlusScore: null,
      characters: [
        {
          characterId: "x",
          region: "EU",
          realmSlug: "tarren-mill",
          name: "X",
          mythicPlusScore: 3000,
          hasCompatibleEvidence: false,
          incompatibilityReason: "INCOMPATIBLE_REFRESH_CONTRACT:WCL_ADAPTER_CHANGED",
        },
      ],
    });
    expect(result.items[0]?.skipReason).toBe(
      "INCOMPATIBLE_REFRESH_CONTRACT:WCL_ADAPTER_CHANGED",
    );
  });

  it("estimates WCL cost for full refresh and respects maxCharacters", () => {
    const result = selectBulkCharacters({
      mode: "FULL_REFRESH",
      minMythicPlusScore: null,
      maxCharacters: 2,
      characters: chars,
    });
    expect(result.selectedCount).toBe(2);
    expect(result.estimatedChildJobs).toBe(2);
    expect(result.estimatedWclCalls).toBe(2 * ESTIMATED_WCL_CALLS_PER_FULL_REFRESH);
  });

  it("builds a stable logical key including dry-run and convert flags", () => {
    expect(
      buildBulkLogicalKey({
        mode: "RECALCULATE_ONLY",
        minMythicPlusScore: null,
        scoreModelId: "model-1",
      }),
    ).toBe("bulk:RECALCULATE_ONLY:all:model-1:live:skip-incompat");
    expect(
      buildBulkLogicalKey({
        mode: "FULL_REFRESH",
        minMythicPlusScore: 2500,
        scoreModelId: null,
        dryRun: true,
        allowFullRefreshOnIncompatible: true,
      }),
    ).toBe("bulk:FULL_REFRESH:2500:active:dry:convert");
  });
});
