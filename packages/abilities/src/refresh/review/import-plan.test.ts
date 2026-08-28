import { describe, expect, it } from "vitest";
import {
  GOLDEN_BLIZZARD_SNAPSHOT,
  GOLDEN_SIMC_SNAPSHOT,
} from "../fixtures/golden-retail.js";
import { runShadowCatalogRefresh } from "../pipeline.js";
import { importBlizzardRefreshSnapshot } from "../sources/blizzard.js";
import { importSimcSpellQuerySnapshot } from "../sources/simc.js";
import {
  assertPinnedReportForImport,
  buildReviewImportPlan,
  isValidCanonicalKeyFormat,
  resolveCanonicalKeyCollision,
  suggestCanonicalKey,
  suggestCuratedCanonicalKey,
} from "./import-plan.js";
import { digestReportBytes } from "./digest-node.js";
import { validateCuratedDraftRule } from "./draft-validation.js";
import type { CatalogRefreshReport } from "../types.js";

function pinnedReportFromFixtures(): CatalogRefreshReport {
  const { report } = runShadowCatalogRefresh({
    snapshots: [
      importBlizzardRefreshSnapshot({ ...GOLDEN_BLIZZARD_SNAPSHOT, datasetKind: "PINNED" }),
      importSimcSpellQuerySnapshot({ ...GOLDEN_SIMC_SNAPSHOT, datasetKind: "PINNED" }),
    ],
    nowIso: "2026-08-16T12:00:00.000Z",
  });
  return { ...report, datasetKind: "PINNED" };
}

describe("ability catalog review import plan", () => {
  it("rejects FIXTURE/MIXED reports", () => {
    const { report } = runShadowCatalogRefresh({
      snapshots: [
        importBlizzardRefreshSnapshot(GOLDEN_BLIZZARD_SNAPSHOT),
        importSimcSpellQuerySnapshot(GOLDEN_SIMC_SNAPSHOT),
      ],
    });
    expect(() => assertPinnedReportForImport(report)).toThrow(/FIXTURE_OR_MIXED_REJECTED/);
  });

  it("imports actionable kinds only and excludes weak/not-observed", () => {
    const report = pinnedReportFromFixtures();
    // Force review queues if fixtures produce them
    const withReview: CatalogRefreshReport = {
      ...report,
      datasetKind: "PINNED",
      review: report.review ?? {
        strongNewCandidates: report.diff.filter((d) => d.status === "MISSING_FROM_CURRENT_CATALOG"),
        weakDiscoveries: [],
        excludedStructurally: [],
        currentRulesNotObserved: report.diff.filter((d) => d.status === "NOT_OBSERVED_IN_CURRENT_QUERIES"),
        removalReview: [],
        bindingReview: report.diff.filter((d) => d.status === "SPELL_BINDING_CHANGED"),
      },
    };
    const reportBytes = Buffer.from("pinned-report-bytes");
    const plan = buildReviewImportPlan(withReview, {
      reportDigest: digestReportBytes(reportBytes),
      topologyClassification: { races: [{ key: "haranir", kind: "EXTERNAL_ONLY" }] },
    });
    expect(plan.items.every((i) =>
      ["NEW_ABILITY_CANDIDATE", "SPELL_BINDING_REVIEW", "TOPOLOGY_REVIEW", "REMOVAL_REVIEW"].includes(i.kind),
    )).toBe(true);
    expect(plan.items.some((i) => i.kind === "TOPOLOGY_REVIEW" && i.name === "haranir")).toBe(true);
    expect(plan.summaryCounts.weakExcluded).toBe(withReview.review!.weakDiscoveries.length);
    expect(plan.summaryCounts.notObservedExcluded).toBe(
      withReview.review!.currentRulesNotObserved.length,
    );
    expect(plan.items.some((i) => i.kind === "REMOVAL_REVIEW")).toBe(false);
    expect(
      plan.items.some(
        (i) => i.primarySpellId === 12472 && (i.kind === "REMOVAL_REVIEW" || i.kind === "NEW_ABILITY_CANDIDATE"),
      ),
    ).toBe(false);
    // Weak rotational rows must not become review items.
    expect(plan.items.some((i) => i.primarySpellId === 47541)).toBe(false);
  });

  it("digests report bytes stably", () => {
    const a = digestReportBytes("abc");
    const b = digestReportBytes(Buffer.from("abc"));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("preserves normalized candidate metadata on import item evidence", () => {
    const report = pinnedReportFromFixtures();
    const withReview: CatalogRefreshReport = {
      ...report,
      datasetKind: "PINNED",
      review: report.review ?? {
        strongNewCandidates: report.diff.filter((d) => d.status === "MISSING_FROM_CURRENT_CATALOG"),
        weakDiscoveries: [],
        excludedStructurally: [],
        currentRulesNotObserved: report.diff.filter((d) => d.status === "NOT_OBSERVED_IN_CURRENT_QUERIES"),
        removalReview: [],
        bindingReview: report.diff.filter((d) => d.status === "SPELL_BINDING_CHANGED"),
      },
    };
    const candidate = withReview.review!.strongNewCandidates.find((c) => c.cooldownSeconds != null);
    expect(candidate).toBeTruthy();
    const plan = buildReviewImportPlan(withReview, {
      reportDigest: digestReportBytes(Buffer.from("candidate-metadata-evidence")),
    });
    const item = plan.items.find(
      (i) => i.primarySpellId === candidate!.primarySpellId && i.kind === "NEW_ABILITY_CANDIDATE",
    );
    expect(item).toBeTruthy();
    expect(item!.evidence.cooldownSeconds).toBe(candidate!.cooldownSeconds);
    expect(item!.evidence.candidateBindings).toBeTruthy();
    expect(item!.evidence.ownershipKind).toBeTruthy();
  });

  it("validates canonical keys and draft collisions", () => {
    expect(isValidCanonicalKeyFormat("priest.defensive-minor.vampiric-embrace")).toBe(true);
    expect(isValidCanonicalKeyFormat("BadKey")).toBe(false);
    expect(
      suggestCanonicalKey({
        classSlug: "priest",
        specSlugs: ["shadow"],
        name: "Vampiric Embrace",
      }),
    ).toBe("priest.shadow.vampiric-embrace");
    expect(
      suggestCanonicalKey({
        classSlug: "demon-hunter",
        specSlugs: ["devourer"],
        name: "Shift",
      }),
    ).toBe("demon-hunter.devourer.shift");
    expect(
      suggestCanonicalKey({
        classSlug: "demon-hunter",
        specSlugs: ["devourer"],
        name: "Shift",
      }),
    ).not.toContain("refresh");
    expect(
      resolveCanonicalKeyCollision("monk.windwalker.flying-serpent-kick", new Set(["monk.windwalker.flying-serpent-kick"])),
    ).toBe("monk.windwalker.flying-serpent-kick-2");
    expect(
      suggestCuratedCanonicalKey(
        {
          classSlug: "monk",
          specSlugs: ["windwalker"],
          name: "Flying Serpent Kick",
          primarySpellId: 101545,
        },
        { reservedKeys: new Set(["monk.windwalker.flying-serpent-kick"]) },
      ),
    ).toBe("monk.windwalker.flying-serpent-kick-2");
    const collision = validateCuratedDraftRule(
      {
        canonicalKey: "mage.offensive.icy-veins",
        name: "Icy Veins",
        spellIds: [12472],
        bindings: [{ spellId: 12472, role: "PRIMARY_ACTIVATION" }],
        category: "OFFENSIVE_MAJOR",
        provenance: {
          source: "CURATED_OVERRIDE",
          verifiedAt: "2026-08-16T00:00:00.000Z",
          gameVersion: "draft",
        },
      },
    );
    expect(collision.errors.some((e) => e.code === "CANONICAL_KEY_COLLISION")).toBe(true);
    const incomplete = validateCuratedDraftRule({
      name: "Vampiric Embrace",
      spellIds: [15286],
      bindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
      classSlug: "priest",
      specSlugs: ["shadow"],
    });
    expect(incomplete.status).toBe("NEEDS_METADATA");
    expect(incomplete.reasonCodes).toEqual(
      expect.arrayContaining(["MISSING_CANONICAL_KEY", "MISSING_CATEGORY", "MISSING_AVAILABILITY", "MISSING_PROVENANCE"]),
    );
  });
});
