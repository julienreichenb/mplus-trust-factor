import { describe, expect, it } from "vitest";
import {
  selectUtilityCapabilityEvidencePages,
  type UtilityEvidencePageRow,
} from "./utility-one-fight-capability-evidence.js";

function page(
  scopeFingerprint: string,
  eventCount: number,
  pageIndex = 0,
): UtilityEvidencePageRow {
  return {
    artifactId: `${scopeFingerprint}:${pageIndex}`,
    pageIndex,
    eventCount,
    scopeFingerprint,
  };
}

const ABILITY_A =
  "scope|ds:Buffs|a:all|fe:ability.id IN (99, 118)|ht:default|res:0|t:1-2|pc:wcl-graphql-v2-events";
const ABILITY_B =
  "scope|ds:Buffs|a:all|fe:ability.id IN (51052, 51514)|ht:default|res:0|t:1-2|pc:wcl-graphql-v2-events";
const BROKEN =
  "scope|ds:Buffs|a:all|fe:ability.id IN (99) AND (source.id IN (1) OR target.id IN (1))|ht:default|res:0|t:1-2|pc:wcl-graphql-v2-events";
const LEGACY =
  "scope|ds:Buffs|a:all|fe:none|ht:default|res:0|t:1-2|pc:wcl-graphql-v2-events";
const CAP_NONE =
  "scope|ds:Interrupts|a:all|fe:cap:NONE|ht:default|res:0|t:1-2|pc:wcl-graphql-v2-events";
const INT_NONE =
  "scope|ds:Interrupts|a:all|fe:none|ht:default|res:0|t:1-2|pc:wcl-graphql-v2-events";

describe("selectUtilityCapabilityEvidencePages", () => {
  it("merges ability-filter Buffs batches and ignores legacy unfiltered + empty combos", () => {
    const selected = selectUtilityCapabilityEvidencePages({
      datasetKey: "Buffs",
      pages: [
        page(LEGACY, 36000),
        page(BROKEN, 0),
        page(ABILITY_A, 222),
        page(ABILITY_B, 106),
      ],
    });
    expect(selected.kind).toBe("CAPABILITY_ABILITY_FILTER_BATCHES");
    expect(selected.pages.map((p) => p.eventCount).sort((a, b) => a - b)).toEqual([
      106, 222,
    ]);
    expect(selected.limitations.some((l) => l.includes("IGNORED_LEGACY_UNFILTERED"))).toBe(
      true,
    );
    expect(
      selected.limitations.some((l) => l.includes("IGNORED_EMPTY_ABILITY_ACTOR_COMBO")),
    ).toBe(true);
  });

  it("prefers capability NONE tag for Interrupts over legacy fe:none", () => {
    const selected = selectUtilityCapabilityEvidencePages({
      datasetKey: "Interrupts",
      pages: [page(INT_NONE, 71), page(CAP_NONE, 71)],
    });
    expect(selected.kind).toBe("CAPABILITY_UNFILTERED_PARTY");
    expect(selected.scopeFingerprints).toEqual([CAP_NONE]);
  });

  it("falls back to legacy unfiltered Casts only when no ability filters exist", () => {
    const castLegacy =
      "scope|ds:Casts|a:all|fe:none|ht:default|res:0|t:1-2|pc:wcl-graphql-v2-events";
    const selected = selectUtilityCapabilityEvidencePages({
      datasetKey: "Casts",
      pages: [page(castLegacy, 100)],
    });
    expect(selected.kind).toBe("LEGACY_UNFILTERED_PARTY");
    expect(selected.limitations[0]).toContain("FALLBACK_LEGACY_UNFILTERED:Casts");
  });
});
