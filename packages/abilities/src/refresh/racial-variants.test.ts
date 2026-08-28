import { describe, expect, it } from "vitest";
import type { AbilityRule } from "../types.js";
import {
  collapseRacialSpellVariants,
  classifyRacialVariantMember,
  racialConceptualGroupKey,
  spellBuildIsCurrentForTarget,
} from "./racial-variants.js";
import type { ExternalAbilityCandidate, ExternalSourceSnapshot } from "./types.js";
import { matchCandidatesToCurrent } from "./match.js";
import { buildReviewImportPlan } from "./review/import-plan.js";
import { runShadowCatalogRefresh } from "./pipeline.js";

function racialCandidate(
  overrides: Partial<ExternalAbilityCandidate> &
    Pick<ExternalAbilityCandidate, "primarySpellId" | "name" | "raceSlugs">,
): ExternalAbilityCandidate {
  const spellId = overrides.primarySpellId;
  const name = overrides.name;
  const raceSlugs = overrides.raceSlugs;
  const {
    primarySpellId: _p,
    name: _n,
    raceSlugs: _r,
    candidateKey,
    bindings,
    sourceObservations,
    cooldownSeconds,
    notes,
    ...rest
  } = overrides;
  return {
    candidateKey:
      candidateKey ?? `shared.refresh.${name.toLowerCase().replace(/\s+/g, "-")}-${spellId}`,
    name,
    primarySpellId: spellId,
    classSlug: null,
    specSlugs: [],
    raceSlugs,
    cooldownSeconds: cooldownSeconds ?? 120,
    charges: null,
    stacks: null,
    isPassive: false,
    catalogRelevance: "ACTIVE_CANDIDATE",
    category: "UNKNOWN",
    bindings: bindings ?? [
      {
        spellId,
        role: "PRIMARY_ACTIVATION",
        source: "SIMULATIONCRAFT",
        certainty: "unverified",
        evidence: "test",
      },
    ],
    sourceObservations: sourceObservations ?? [
      {
        source: "SIMULATIONCRAFT",
        state: "PRESENT",
        identity: {
          source: "SIMULATIONCRAFT",
          datasetKind: "PINNED",
          sourceVersion: "test",
          sourceRevision: "abc",
          retrievedAt: "2026-01-01T00:00:00.000Z",
          captureProvenance: "REAL_CAPTURE",
          dataMode: "LIVE",
          validFromBuild: "69299",
        },
      },
    ],
    certainty: "unverified",
    validFromBuild: "69299",
    notes: notes ?? [],
    eligibilityState: "STRONG_REVIEW_CANDIDATE",
    eligibilityReasons: ["RACIAL_ACTIVE", "HAS_COOLDOWN"],
    ownershipKind: "PLAYABLE_RACE",
    ...rest,
  };
}

const bloodFuryRule = {
  canonicalKey: "shared.racial.offensive.blood-fury",
  name: "Blood Fury",
  spellIds: [20572],
  aliases: [33697, 33702],
  classSlug: null,
  specSlugs: [],
  roles: ["DPS"],
  category: "OFFENSIVE_MINOR",
  availability: "SHARED",
  sourceOwnership: "PLAYER",
  raceSlugs: ["orc", "maghar-orc"],
  sharedAcrossSpecs: true,
  cooldownSeconds: 120,
  supportCertainty: "uncertain",
  provenance: { source: "CURATED_OVERRIDE", verifiedAt: "2026-01-01T00:00:00.000Z" },
} as unknown as AbilityRule;

describe("racial variant collapse", () => {
  it("excludes old-build racial variants from current review candidates", () => {
    const current = racialCandidate({
      primarySpellId: 100,
      name: "Arcane Torrent",
      raceSlugs: ["blood-elf"],
      notes: ["spell-validity:from=69000;to="],
    });
    const historical = racialCandidate({
      primarySpellId: 50,
      name: "Arcane Torrent",
      raceSlugs: ["blood-elf"],
      notes: ["spell-validity:from=10000;to=50000"],
    });
    const { candidates, report } = collapseRacialSpellVariants([current, historical], {
      targetBuild: "69299",
      currentRules: [],
    });
    expect(report.historicalVariantsExcluded).toBe(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.primarySpellId).toBe(100);
    expect(candidates[0]!.notes.some((n) => n.includes("historical-ids-excluded:50"))).toBe(true);
  });

  it("retains the current-build variant", () => {
    const member = classifyRacialVariantMember({
      candidate: racialCandidate({
        primarySpellId: 28730,
        name: "Arcane Torrent",
        raceSlugs: ["blood-elf"],
        notes: ["spell-validity:from=69000;to="],
      }),
      currentRules: [],
      targetBuild: "69299",
    });
    expect(member.validity).toBe("CURRENT_FOR_TARGET_BUILD");
  });

  it("merges two simultaneous current IDs into one review candidate", () => {
    const a = racialCandidate({
      primarySpellId: 20572,
      name: "Blood Fury",
      raceSlugs: ["orc"],
    });
    const b = racialCandidate({
      primarySpellId: 33697,
      name: "Blood Fury",
      raceSlugs: ["orc"],
    });
    const { candidates, report } = collapseRacialSpellVariants([a, b], {
      currentRules: [bloodFuryRule],
      targetBuild: "69299",
    });
    expect(candidates).toHaveLength(1);
    expect(report.currentMultiIdGroups).toBe(1);
    expect(candidates[0]!.bindings.map((x) => x.spellId).sort((x, y) => x - y)).toEqual([
      20572, 33697,
    ]);
    expect(candidates[0]!.candidateKey).toBe("shared.racial.offensive.blood-fury");
  });

  it("never merges same-named racials across different races", () => {
    const bloodElf = racialCandidate({
      primarySpellId: 1,
      name: "Arcane Torrent",
      raceSlugs: ["blood-elf"],
    });
    const voidElf = racialCandidate({
      primarySpellId: 2,
      name: "Arcane Torrent",
      raceSlugs: ["void-elf"],
    });
    expect(racialConceptualGroupKey(bloodElf)).not.toBe(racialConceptualGroupKey(voidElf));
    const { candidates } = collapseRacialSpellVariants([bloodElf, voidElf], {
      targetBuild: "69299",
    });
    expect(candidates).toHaveLength(2);
  });

  it("keeps unknown temporal validity explicit instead of dropping the group", () => {
    const ids = [25046, 28730, 50613, 69179, 80483, 129597, 155145, 202719, 232633];
    const group = ids.map((id) =>
      racialCandidate({
        primarySpellId: id,
        name: "Arcane Torrent",
        raceSlugs: ["blood-elf"],
      }),
    );
    const { candidates, report } = collapseRacialSpellVariants(group, {
      currentRules: [],
      targetBuild: "69299",
    });
    expect(candidates).toHaveLength(1);
    expect(report.ambiguousGroups).toBe(1);
    expect(candidates[0]!.notes.some((n) => n.startsWith("ambiguous-ids:"))).toBe(true);
    expect(
      candidates[0]!.notes.some((n) => n.includes("racial-variant-validity:AMBIGUOUS_VALIDITY")),
    ).toBe(true);
    expect(candidates[0]!.bindings.length).toBeGreaterThanOrEqual(ids.length);
  });

  it("does not invent current status from snapshot-wide validFromBuild alone", () => {
    expect(
      spellBuildIsCurrentForTarget({
        validFromBuild: "69299",
        validToBuild: undefined,
        targetBuild: "69299",
        spellSpecific: false,
      }),
    ).toBeNull();
  });

  it("Arcane Torrent-style rework history does not produce N pending import items", () => {
    const snap: ExternalSourceSnapshot = {
      identity: {
        source: "SIMULATIONCRAFT",
        datasetKind: "PINNED",
        sourceVersion: "test",
        sourceRevision: "a060a35",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        captureProvenance: "REAL_CAPTURE",
        dataMode: "LIVE",
        validFromBuild: "69299",
      },
      simulationCraft: {
        gitCommitSha: "a060a35",
        extractorVersion: "test",
        wowBuild: "69299",
        dataMode: "LIVE",
      },
      inventories: [
        {
          kind: "RACE",
          raceSlug: "blood-elf",
          completeness: "COMPLETE",
          queryClaim: "COMPLETE_FOR_QUERY",
          claimsCompleteToolkit: false,
          queryExpression: "race_spell",
        },
      ],
      records: [25046, 28730, 50613, 69179, 80483, 129597, 155145, 202719, 232633].map(
        (spellId) => ({
          spellId,
          name: "Arcane Torrent",
          raceSlugs: ["blood-elf"],
          cooldownSeconds: 90,
          isPassive: false,
          catalogRelevant: true,
        }),
      ),
    };
    const { report } = runShadowCatalogRefresh({
      snapshots: [snap],
      currentRules: [],
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    const torrents = (report.review?.strongNewCandidates ?? []).filter(
      (d) => d.name === "Arcane Torrent",
    );
    expect(torrents).toHaveLength(1);
    const plan = buildReviewImportPlan(
      {
        ...report,
        datasetKind: "PINNED",
        publication: "NONE",
        validation: { valid: true, errors: [], warnings: [] },
      },
      {
        reportDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    );
    const torrentItems = plan.items.filter((i) => i.name === "Arcane Torrent");
    expect(torrentItems).toHaveLength(1);
    expect(torrentItems[0]!.identityKey).toContain("racial:blood-elf:arcane-torrent");
  });

  it("matches catalog aliases so Blood Fury variants are not treated as missing", () => {
    const collapsed = collapseRacialSpellVariants(
      [
        racialCandidate({ primarySpellId: 33697, name: "Blood Fury", raceSlugs: ["orc"] }),
        racialCandidate({ primarySpellId: 33702, name: "Blood Fury", raceSlugs: ["orc"] }),
      ],
      { currentRules: [bloodFuryRule], targetBuild: "69299" },
    ).candidates;
    const { unmatchedCandidates, pairs } = matchCandidatesToCurrent(collapsed, [bloodFuryRule]);
    expect(unmatchedCandidates).toHaveLength(0);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.current.canonicalKey).toBe("shared.racial.offensive.blood-fury");
  });
});
