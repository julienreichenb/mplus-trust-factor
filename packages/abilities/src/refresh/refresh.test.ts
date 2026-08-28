import { describe, expect, it } from "vitest";
import { compareBindingRoles, projectCurrentRuleBindings } from "./bindings.js";
import { diffCandidateCatalog } from "./diff.js";
import {
  GOLDEN_BLIZZARD_SNAPSHOT,
  GOLDEN_SIMC_SNAPSHOT,
  FIXTURE_SIMC_COMMIT_SHA,
} from "./fixtures/golden-retail.js";
import { matchCandidatesToCurrent } from "./match.js";
import { normalizeSnapshots } from "./normalize.js";
import { formatShadowRefreshSummary, runShadowCatalogRefresh } from "./pipeline.js";
import { isForbiddenMutableIdentity, isSimcCommitSha } from "./snapshot-identity.js";
import { importBlizzardRefreshSnapshot, loadBlizzardSnapshotViaTransport } from "./sources/blizzard.js";
import { importSimcSpellQuerySnapshot } from "./sources/simc.js";
import { isRetailStaticNamespace } from "./topology.js";
import { validateRefreshCandidates, validateRefreshSnapshots } from "./validate.js";
import { getAllRegisteredRules } from "../registry.js";
import { assessCatalogEligibility } from "./eligibility.js";
import type { ExternalAbilityCandidate } from "./types.js";

function goldenSnapshots() {
  return [
    importBlizzardRefreshSnapshot(GOLDEN_BLIZZARD_SNAPSHOT),
    importSimcSpellQuerySnapshot(GOLDEN_SIMC_SNAPSHOT),
  ];
}

describe("refresh snapshot identity", () => {
  it("rejects mutable labels and requires a SimC SHA", () => {
    expect(isForbiddenMutableIdentity("latest")).toBe(true);
    expect(isForbiddenMutableIdentity("main")).toBe(true);
    expect(isForbiddenMutableIdentity("midnight")).toBe(true);
    expect(isSimcCommitSha("main")).toBe(false);
    expect(isSimcCommitSha(FIXTURE_SIMC_COMMIT_SHA)).toBe(true);
    expect(() =>
      importSimcSpellQuerySnapshot({
        ...GOLDEN_SIMC_SNAPSHOT,
        simcCommitSha: "midnight",
      }),
    ).toThrow(/git commit SHA|binary-reported prefix/i);
  });

  it("rejects non-Retail Blizzard namespaces", () => {
    expect(isRetailStaticNamespace("static-us")).toBe(true);
    expect(isRetailStaticNamespace("static-classic-us")).toBe(false);
    expect(() =>
      importBlizzardRefreshSnapshot({
        ...GOLDEN_BLIZZARD_SNAPSHOT,
        namespace: "static-classic-us",
      }),
    ).toThrow(/non-Retail/);
  });
});

describe("refresh normalization and bindings", () => {
  it("keeps unknown fields unknown and does not default verified", () => {
    const candidates = normalizeSnapshots(goldenSnapshots());
    expect(candidates.every((c) => c.certainty === "unverified" || c.certainty === "conflicting")).toBe(
      true,
    );
    const embrace = candidates.find((c) => c.primarySpellId === 15286);
    expect(embrace?.cooldownSeconds).toBe(120);
    expect(embrace?.category).toBe("UNKNOWN");
  });

  it("preserves Stormkeeper typed binding roles instead of a flat ID set", () => {
    const candidates = normalizeSnapshots(goldenSnapshots());
    const storm = candidates.find((c) => c.candidateKey === "shaman.offensive.stormkeeper");
    expect(storm).toBeDefined();
    const roles = storm!.bindings.map((b) => `${b.spellId}:${b.role}`).sort();
    expect(roles).toContain("191634:PRIMARY_ACTIVATION");
    expect(roles).toContain("191634:STACK_AURA");
    expect(roles).toContain("191634:TRIGGERED_EFFECT");
    expect(roles).toContain("383009:CAST_ALIAS");
    const current = getAllRegisteredRules().find((r) => r.canonicalKey === "shaman.offensive.stormkeeper")!;
    const changes = compareBindingRoles(projectCurrentRuleBindings(current), storm!.bindings);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.spellId === 191634 && c.candidateRoles.includes("STACK_AURA"))).toBe(
      true,
    );
  });

  it("excludes passive racial discoveries from default candidates", () => {
    const candidates = normalizeSnapshots(goldenSnapshots());
    expect(candidates.some((c) => c.name === "Frost Resistance")).toBe(false);
    expect(candidates.some((c) => c.candidateKey === "shared.racial.stoneform")).toBe(true);
    const withPassives = normalizeSnapshots(goldenSnapshots(), { includePassiveDiscoveries: true });
    expect(withPassives.some((c) => c.name === "Frost Resistance")).toBe(true);
  });
});

describe("refresh matching, conflicts, and topology", () => {
  it("emits AMBIGUOUS instead of picking a winner", () => {
    const clone: ExternalAbilityCandidate = {
      candidateKey: "mage.offensive.icy-veins",
      name: "Dup",
      primarySpellId: 12472,
      classSlug: "mage",
      specSlugs: ["frost"],
      raceSlugs: [],
      catalogRelevance: "ACTIVE_CANDIDATE",
      bindings: [
        {
          spellId: 12472,
          role: "PRIMARY_ACTIVATION",
          source: "SIMULATIONCRAFT",
          certainty: "unverified",
        },
      ],
      sourceObservations: [],
      certainty: "unverified",
      notes: [],
      ...assessCatalogEligibility({
        candidateKey: "mage.offensive.icy-veins",
        name: "Dup",
        primarySpellId: 12472,
        classSlug: "mage",
        specSlugs: ["frost"],
        raceSlugs: [],
        catalogRelevance: "ACTIVE_CANDIDATE",
        bindings: [],
        sourceObservations: [],
        certainty: "unverified",
        notes: [],
      }),
    };
    const other = { ...clone };
    const current = getAllRegisteredRules().filter((r) => r.canonicalKey === "mage.offensive.icy-veins");
    const result = matchCandidatesToCurrent([clone, other], current);
    expect(result.ambiguous.length).toBeGreaterThan(0);
    const diff = diffCandidateCatalog({
      candidates: [clone, other],
      currentRules: current,
      snapshots: goldenSnapshots(),
    });
    expect(diff.some((d) => d.status === "AMBIGUOUS")).toBe(true);
  });

  it("validates unknown class/spec/race and duplicate keys", () => {
    const bad: ExternalAbilityCandidate = {
      candidateKey: "x",
      name: "X",
      primarySpellId: 1,
      classSlug: "classic-mage",
      specSlugs: ["frost"],
      raceSlugs: ["murloc"],
      catalogRelevance: "UNCLASSIFIED",
      bindings: [],
      sourceObservations: [],
      certainty: "unverified",
      notes: [],
      ...assessCatalogEligibility({
        candidateKey: "x",
        name: "X",
        primarySpellId: 1,
        classSlug: "classic-mage",
        specSlugs: ["frost"],
        raceSlugs: ["murloc"],
        catalogRelevance: "UNCLASSIFIED",
        bindings: [],
        sourceObservations: [],
        certainty: "unverified",
        notes: [],
      }),
    };
    const report = validateRefreshCandidates([bad, { ...bad }]);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "DUPLICATE_CANDIDATE_IDENTITY")).toBe(true);
    expect(report.errors.some((e) => e.code === "UNKNOWN_RETAIL_CLASS")).toBe(true);
    expect(report.errors.some((e) => e.code === "INVALID_RACE_APPLICABILITY")).toBe(false);
    expect(report.warnings.some((e) => e.code === "UNKNOWN_TO_CURRENT_TOPOLOGY")).toBe(true);
  });

  it("does not treat a failed snapshot as an empty complete inventory", () => {
    const broken = importSimcSpellQuerySnapshot(GOLDEN_SIMC_SNAPSHOT);
    broken.identity.sourceRevision = "midnight";
    broken.simulationCraft = { gitCommitSha: "midnight", extractorVersion: "x" };
    const { report } = runShadowCatalogRefresh({
      snapshots: [broken],
      nowIso: "2026-08-16T12:00:00.000Z",
    });
    expect(report.validation.valid).toBe(false);
    expect(report.diff.some((d) => d.status === "MISSING_FROM_EXTERNAL_SOURCES")).toBe(false);
  });

  it("uses injectable Blizzard transport without production network", async () => {
    const calls: string[] = [];
    const json = await loadBlizzardSnapshotViaTransport(
      {
        getJson: async ({ path }) => {
          calls.push(path);
          return { id: 8, name: "Mage" };
        },
      },
      { namespace: "static-us", locale: "en_US", path: "/data/wow/playable-class/index" },
    );
    expect(calls).toEqual(["/data/wow/playable-class/index"]);
    expect(json).toEqual({ id: 8, name: "Mage" });
    await expect(
      loadBlizzardSnapshotViaTransport(
        { getJson: async () => ({}) },
        { namespace: "static-classic-us", locale: "en_US", path: "/x" },
      ),
    ).rejects.toThrow(/non-Retail/);
  });
});

describe("golden refresh cases", () => {
  const { report, candidates, currentRuleEvidence } = runShadowCatalogRefresh({
    snapshots: goldenSnapshots(),
    nowIso: "2026-08-16T12:00:00.000Z",
  });

  it("A. Icy Veins is not observed in SimC query, not a removal", () => {
    const icyEvidence = currentRuleEvidence.find((e) => e.canonicalKey === "mage.offensive.icy-veins");
    expect(icyEvidence?.identityObserved).toBe(true);
    expect(icyEvidence?.notObservedInCurrentQueries).toBe(true);
    const icy = report.diff.find((d) => d.currentCanonicalKey === "mage.offensive.icy-veins");
    expect(icy?.status).not.toBe("REMOVAL_REVIEW_CANDIDATE");
    expect(icy?.status).not.toBe("MISSING_FROM_EXTERNAL_SOURCES");
    expect(getAllRegisteredRules().some((r) => r.canonicalKey === "mage.offensive.icy-veins")).toBe(
      true,
    );
  });

  it("B. Vampiric Embrace is missing from current catalog with provenance", () => {
    const ve = report.diff.find(
      (d) => d.candidateKey === "priest.shadow.vampiric-embrace" || d.primarySpellId === 15286,
    );
    expect(ve?.status).toBe("MISSING_FROM_CURRENT_CATALOG");
    expect(ve?.primarySpellId).toBe(15286);
    expect(ve?.name).toBe("Vampiric Embrace");
    expect(ve?.classSlug).toBe("priest");
    expect(ve?.specSlugs).toContain("shadow");
    expect(ve?.sourceObservations.length).toBeGreaterThan(0);
    expect(getAllRegisteredRules().some((r) => r.canonicalKey.includes("vampiric-embrace"))).toBe(
      false,
    );
  });

  it("C. Stormkeeper surfaces a typed binding mismatch", () => {
    const sk = report.diff.find((d) => d.currentCanonicalKey === "shaman.offensive.stormkeeper");
    expect(sk?.status).toBe("SPELL_BINDING_CHANGED");
    expect(sk?.bindingChanges?.length).toBeGreaterThan(0);
    const idSetEqual =
      new Set([191634, 383009]).size === 2 &&
      (sk?.bindingChanges ?? []).every((c) => c.spellId === 191634 || c.spellId === 383009);
    expect(idSetEqual).toBe(true);
    const candidate = candidates.find((c) => c.candidateKey === "shaman.offensive.stormkeeper");
    expect(candidate?.bindings.some((b) => b.role === "STACK_AURA")).toBe(true);
  });

  it("produces a coverage report and does not publish", () => {
    expect(report.publication).toBe("NONE");
    expect(report.datasetKind).toBe("FIXTURE");
    expect(report.coverage.claimedCompleteInventories).toBe(0);
    expect(report.snapshots.every((s) => s.captureProvenance === "SYNTHETIC_CONTRACT")).toBe(true);
    expect(report.coverage.partialOrUnknownInventories).toBeGreaterThan(0);
    expect(report.coverage.inventoryScopes.some((s) => s.claimsCompleteToolkit)).toBe(false);
    expect(formatShadowRefreshSummary(report)).toContain("WARNING: FIXTURE / DEMO DATA");
    expect(report.coverage.currentCatalogEntries).toBe(getAllRegisteredRules().length);
    expect(report.coverage.missingFromCurrentCatalog).toBeGreaterThanOrEqual(1);
    expect(report.coverage.topology.matrixSpecCount).toBeGreaterThan(0);
    expect(validateRefreshSnapshots(goldenSnapshots()).valid).toBe(true);
  });
});
