import { describe, expect, it } from "vitest";
import { assessCatalogEligibility } from "./eligibility.js";
import { GOLDEN_SIMC_SNAPSHOT, GOLDEN_BLIZZARD_SNAPSHOT } from "./fixtures/golden-retail.js";
import {
  REAL_SPELLQUERY_XML_PROVENANCE,
  SPELLQUERY_CONTRACT_XML_PROVENANCE,
} from "./fixtures/spellquery-xml.js";
import { runShadowCatalogRefresh } from "./pipeline.js";
import { forbidCrossSourceNumericRaceJoin, raceIdentitiesJoinable } from "./race-identity.js";
import { classifySpecScope } from "./scope-classify.js";
import { importBlizzardRefreshSnapshot } from "./sources/blizzard.js";
import { importSimcSpellQuerySnapshot, type SimcSpellQueryExport } from "./sources/simc.js";
import { diffSimcSourceSnapshots } from "./source-snapshot-diff.js";
import { validateRefreshCandidates } from "./validate.js";
import type { ExternalAbilityCandidate } from "./types.js";

function simcClone(overrides: Partial<SimcSpellQueryExport> = {}): SimcSpellQueryExport {
  return {
    ...GOLDEN_SIMC_SNAPSHOT,
    ...overrides,
    inventories: overrides.inventories ?? GOLDEN_SIMC_SNAPSHOT.inventories.map((i) => ({ ...i })),
    spells: overrides.spells ?? GOLDEN_SIMC_SNAPSHOT.spells.map((s) => ({ ...s })),
  };
}

describe("refresh semantics phase 2.6", () => {
  it("treats class_spell/spec_spell completeness as COMPLETE_FOR_QUERY, not catalog toolkit", () => {
    const snap = importSimcSpellQuerySnapshot(GOLDEN_SIMC_SNAPSHOT);
    expect(snap.inventories.every((i) => i.claimsCompleteToolkit === false)).toBe(true);
    expect(snap.inventories.some((i) => i.queryClaim === "COMPLETE_FOR_QUERY")).toBe(true);
    const { report } = runShadowCatalogRefresh({
      snapshots: [importBlizzardRefreshSnapshot(GOLDEN_BLIZZARD_SNAPSHOT), snap],
    });
    expect(report.coverage.claimedCompleteInventories).toBe(0);
  });

  it("does not treat raw source absence as removal", () => {
    const { report } = runShadowCatalogRefresh({
      snapshots: [
        importBlizzardRefreshSnapshot(GOLDEN_BLIZZARD_SNAPSHOT),
        importSimcSpellQuerySnapshot(GOLDEN_SIMC_SNAPSHOT),
      ],
    });
    expect(report.diff.some((d) => d.status === "REMOVAL_REVIEW_CANDIDATE")).toBe(false);
    expect(report.diff.some((d) => d.status === "MISSING_FROM_EXTERNAL_SOURCES")).toBe(false);
  });

  it("creates removal evidence from temporal present→absent with equivalent queries", () => {
    const previous = simcClone();
    const current = simcClone({
      simcCommitSha: "cccccccccccccccccccccccccccccccccccccccc",
      spells: GOLDEN_SIMC_SNAPSHOT.spells.filter((s) => s.spellId !== 84714),
    });
    const temporal = diffSimcSourceSnapshots({ previous, current });
    expect(temporal.comparable).toBe(true);
    expect(temporal.entries.some((e) => e.spellId === 84714 && e.status === "REMOVED")).toBe(true);
  });

  it("does not create removal evidence when absent in both snapshots", () => {
    const previous = simcClone({ spells: GOLDEN_SIMC_SNAPSHOT.spells.filter((s) => s.spellId !== 12472) });
    const current = simcClone({
      simcCommitSha: "cccccccccccccccccccccccccccccccccccccccc",
      spells: GOLDEN_SIMC_SNAPSHOT.spells.filter((s) => s.spellId !== 12472),
    });
    const temporal = diffSimcSourceSnapshots({ previous, current });
    expect(temporal.entries.some((e) => e.spellId === 12472 && e.status === "REMOVED")).toBe(false);
  });

  it("does not produce REMOVED when query/scope changed", () => {
    const previous = simcClone();
    const current = simcClone({
      simcCommitSha: "cccccccccccccccccccccccccccccccccccccccc",
      inventories: GOLDEN_SIMC_SNAPSHOT.inventories.map((i) => ({
        ...i,
        queryExpression: "talent",
      })),
      spells: [],
    });
    const temporal = diffSimcSourceSnapshots({ previous, current });
    expect(temporal.comparable).toBe(false);
    expect(temporal.totals.REMOVED).toBe(0);
  });

  it("keeps pet rows in raw discovery but excludes them from strong review", () => {
    const file = simcClone({
      spells: [
        {
          spellId: 16827,
          name: "Claw",
          classSlug: "hunter",
          specSlugs: ["ferocity"],
          isPassive: false,
          cooldownSeconds: 0,
        },
      ],
    });
    const { candidates, report } = runShadowCatalogRefresh({
      snapshots: [importSimcSpellQuerySnapshot(file)],
      includePassiveDiscoveries: true,
    });
    const claw = candidates.find((c) => c.primarySpellId === 16827);
    expect(claw).toBeDefined();
    expect(claw?.eligibilityState).toBe("EXCLUDED_STRUCTURALLY");
    expect(claw?.eligibilityReasons).toContain("PET_OWNED");
    expect(report.diff.some((d) => d.primarySpellId === 16827 && d.status === "MISSING_FROM_CURRENT_CATALOG")).toBe(
      false,
    );
    expect(classifySpecScope("hunter", "ferocity")).toBe("PET_TALENT_TREE");
  });

  it("keeps passives in raw discovery but not as strong active candidates", () => {
    const { candidates, report } = runShadowCatalogRefresh({
      snapshots: [importSimcSpellQuerySnapshot(GOLDEN_SIMC_SNAPSHOT)],
      includePassiveDiscoveries: true,
    });
    const frostRes = candidates.find((c) => c.primarySpellId === 20596);
    expect(frostRes?.eligibilityState).toBe("EXCLUDED_STRUCTURALLY");
    expect(frostRes?.eligibilityReasons).toContain("PASSIVE");
    expect(report.review?.strongNewCandidates.some((d) => d.primarySpellId === 20596)).toBe(false);
  });

  it("leaves rotational actives unclassified/weak without scoring taxonomy", () => {
    const file = simcClone({
      spells: [
        {
          spellId: 47541,
          name: "Death Coil",
          classSlug: "deathknight",
          specSlugs: ["unholy"],
          isPassive: false,
          cooldownSeconds: 0,
        },
      ],
    });
    const { candidates } = runShadowCatalogRefresh({
      snapshots: [importSimcSpellQuerySnapshot(file)],
    });
    const coil = candidates.find((c) => c.primarySpellId === 47541)!;
    expect(coil.eligibilityState).toBe("WEAK_REVIEW_CANDIDATE");
    expect(coil.category).toBe("UNKNOWN");
  });

  it("treats external-only official topology as a warning, not malformed data", () => {
    const haranir: ExternalAbilityCandidate = {
      candidateKey: "shared.racial.haranir-x",
      name: "X",
      primarySpellId: 99,
      classSlug: null,
      specSlugs: [],
      raceSlugs: ["haranir"],
      catalogRelevance: "ACTIVE_CANDIDATE",
      bindings: [],
      sourceObservations: [
        {
          source: "BLIZZARD",
          state: "PRESENT",
          identity: importBlizzardRefreshSnapshot(GOLDEN_BLIZZARD_SNAPSHOT).identity,
        },
      ],
      certainty: "unverified",
      notes: [],
      ...assessCatalogEligibility({
        candidateKey: "shared.racial.haranir-x",
        name: "X",
        primarySpellId: 99,
        classSlug: null,
        specSlugs: [],
        raceSlugs: ["haranir"],
        catalogRelevance: "ACTIVE_CANDIDATE",
        bindings: [],
        sourceObservations: [],
        certainty: "unverified",
        notes: [],
      }),
    };
    const report = validateRefreshCandidates([haranir]);
    expect(report.errors.some((e) => e.code === "INVALID_EXTERNAL_RECORD")).toBe(false);
    expect(report.errors.some((e) => e.code === "INVALID_RACE_APPLICABILITY")).toBe(false);
    expect(report.warnings.some((e) => e.code === "UNKNOWN_TO_CURRENT_TOPOLOGY")).toBe(true);
  });

  it("never joins SimC and Blizzard races by numeric ID", () => {
    expect(forbidCrossSourceNumericRaceJoin(3, 3)).toBe("FORBIDDEN_NUMERIC_CROSS_SOURCE_JOIN");
    expect(
      raceIdentitiesJoinable(
        { source: "SIMULATIONCRAFT", sourceLocalId: 3, normalizedSlug: "dwarf", name: "Dwarf" },
        { source: "BLIZZARD", sourceLocalId: 3, normalizedSlug: "night-elf", name: "Night Elf" },
      ),
    ).toBe(false);
    expect(
      raceIdentitiesJoinable(
        { source: "SIMULATIONCRAFT", sourceLocalId: 99, normalizedSlug: "dwarf", name: "Dwarf" },
        { source: "BLIZZARD", sourceLocalId: 3, normalizedSlug: "dwarf", name: "Dwarf" },
      ),
    ).toBe(true);
  });

  it("marks synthetic fixtures as SYNTHETIC_CONTRACT, not REAL_CAPTURE", () => {
    const snap = importSimcSpellQuerySnapshot(GOLDEN_SIMC_SNAPSHOT);
    expect(snap.identity.captureProvenance).toBe("SYNTHETIC_CONTRACT");
    expect(snap.identity.captureProvenance).not.toBe("REAL_CAPTURE");
    expect(SPELLQUERY_CONTRACT_XML_PROVENANCE).toBe("SYNTHETIC_CONTRACT");
    expect(REAL_SPELLQUERY_XML_PROVENANCE).toBe("REAL_CAPTURE");
  });
});
