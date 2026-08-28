import { describe, expect, it } from "vitest";
import {
  ABILITY_CATALOG_REVIEW_PLAN_SCHEMA_VERSION,
  buildReviewImportPlan,
  type ReviewImportPlan,
} from "./import-plan.js";
import { digestReportBytes, digestReviewPlan } from "./digest-node.js";
import {
  GOLDEN_BLIZZARD_SNAPSHOT,
  GOLDEN_SIMC_SNAPSHOT,
} from "../fixtures/golden-retail.js";
import { runShadowCatalogRefresh } from "../pipeline.js";
import { importBlizzardRefreshSnapshot } from "../sources/blizzard.js";
import { importSimcSpellQuerySnapshot } from "../sources/simc.js";

function pinnedPlan(reportDigest = "a".repeat(64)): ReviewImportPlan {
  const { report } = runShadowCatalogRefresh({
    snapshots: [
      importBlizzardRefreshSnapshot({ ...GOLDEN_BLIZZARD_SNAPSHOT, datasetKind: "PINNED" }),
      importSimcSpellQuerySnapshot({ ...GOLDEN_SIMC_SNAPSHOT, datasetKind: "PINNED" }),
    ],
    nowIso: "2026-08-16T12:00:00.000Z",
  });
  return buildReviewImportPlan(
    { ...report, datasetKind: "PINNED" },
    { reportDigest },
  );
}

describe("review plan digest vs source report digest", () => {
  it("keeps source report digest independent from review plan digest", () => {
    const sourceA = digestReportBytes('{"generatedAt":"t1"}');
    const sourceB = digestReportBytes('{"generatedAt":"t2"}');
    expect(sourceA).not.toBe(sourceB);

    const plan = pinnedPlan(sourceA);
    const planDigest = digestReviewPlan(plan);
    expect(planDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(planDigest).not.toBe(sourceA);
    expect(plan.schemaVersion).toBe(ABILITY_CATALOG_REVIEW_PLAN_SCHEMA_VERSION);
  });

  it("same normalized plan content yields the same reviewPlanDigest", () => {
    const a = digestReviewPlan(pinnedPlan("a".repeat(64)));
    const b = digestReviewPlan(pinnedPlan("b".repeat(64)));
    // reportDigest is excluded from plan digest payload
    expect(a).toBe(b);
  });

  it("item identity changes change reviewPlanDigest", () => {
    const plan = pinnedPlan();
    const base = digestReviewPlan(plan);
    const mutated: ReviewImportPlan = {
      ...plan,
      items: [
        ...plan.items,
        {
          kind: "NEW_ABILITY_CANDIDATE",
          identityKey: "NEW_ABILITY_CANDIDATE:racial:blood-elf:arcane-torrent",
          primarySpellId: 28730,
          name: "Arcane Torrent",
          matchedCanonicalKey: null,
          classSlug: null,
          specSlugs: [],
          raceSlugs: ["blood-elf"],
          eligibilityState: "STRONG_REVIEW_CANDIDATE",
          eligibilityReasons: [],
          reviewReason: "test",
          evidence: { racialVariant: { validity: "AMBIGUOUS_VALIDITY" } },
          sourceProvenance: {},
        },
      ],
    };
    expect(digestReviewPlan(mutated)).not.toBe(base);
  });
});
