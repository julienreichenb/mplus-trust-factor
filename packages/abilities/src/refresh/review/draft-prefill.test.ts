import { describe, expect, it } from "vitest";
import {
  candidateEvidenceFromDiffEntry,
  mergeCuratedDraftInput,
  parseCandidateBindings,
  prefillCuratedDraftDefaults,
  provenanceFromRefreshEvidence,
} from "./draft-prefill.js";
import { membershipFromScope, mergeSimcMembership } from "../extract/simc-availability.js";
import { applyBusinessMetadataToReviewDraft } from "./business-metadata.js";
import { validateCuratedDraftRule } from "./draft-validation.js";

describe("draft prefill from refresh evidence", () => {
  const rollTheBonesEvidence = {
    status: "MISSING_FROM_CURRENT_CATALOG",
    candidateKey: "rogue.refresh.roll-the-bones-1214909",
    cooldownSeconds: 45,
    charges: null,
    ownershipKind: "PLAYABLE_PLAYER",
    validFromBuild: "69299",
    candidateBindings: [{ spellId: 1214909, role: "PRIMARY_ACTIVATION" }],
    sourceObservations: [
      {
        source: "SIMULATIONCRAFT",
        state: "PRESENT",
        identity: {
          source: "SIMULATIONCRAFT",
          datasetKind: "PINNED",
          sourceVersion: "spellquery-export-0.1.0",
          sourceRevision: "abc123",
          retrievedAt: "2026-08-16T12:00:00.000Z",
          validFromBuild: "69299",
          captureProvenance: "REAL_CAPTURE",
        },
      },
    ],
  };

  it("prefills factual metadata without category or dimensions", () => {
    const draft = prefillCuratedDraftDefaults({
      name: "Roll the Bones",
      primarySpellId: 1214909,
      matchedCanonicalKey: null,
      classSlug: "rogue",
      specSlugs: ["outlaw"],
      raceSlugs: [],
      evidence: rollTheBonesEvidence,
      sourceProvenance: {
        sourceObservations: rollTheBonesEvidence.sourceObservations,
      },
      wowBuild: "69299",
      generatedAt: "2026-08-16T12:00:00.000Z",
    });

    expect(draft.name).toBe("Roll the Bones");
    expect(draft.canonicalKey).toBe("rogue.outlaw.roll-the-bones");
    expect(draft.canonicalKey).not.toContain("refresh");
    expect(draft.spellIds).toEqual([1214909]);
    expect(draft.bindings).toEqual([{ spellId: 1214909, role: "PRIMARY_ACTIVATION" }]);
    expect(draft.classSlug).toBe("rogue");
    expect(draft.specSlugs).toEqual(["outlaw"]);
    expect(draft.cooldownSeconds).toBe(45);
    expect(draft.sourceOwnership).toBe("PLAYER");
    expect(draft.validFromBuild).toBe("69299");
    expect(draft.category).toBeNull();
    expect(draft.dimensionTags).toEqual([]);
    expect(draft.availability).toBeNull();
    expect(draft.provenance?.source).toBe("SIMC_ADVISORY");
  });

  it("prefills Shift with a curated canonical key and no refresh segment", () => {
    const draft = prefillCuratedDraftDefaults({
      name: "Shift",
      primarySpellId: 1234796,
      matchedCanonicalKey: null,
      classSlug: "demon-hunter",
      specSlugs: ["devourer"],
      raceSlugs: [],
      evidence: {
        candidateKey: "demon-hunter.refresh.shift-1234796",
        cooldownSeconds: null,
        ownershipKind: "PLAYABLE_PLAYER",
        candidateBindings: [{ spellId: 1234796, role: "PRIMARY_ACTIVATION" }],
      },
      sourceProvenance: {},
      wowBuild: "69299",
    });

    expect(draft.canonicalKey).toBe("demon-hunter.devourer.shift");
    expect(draft.canonicalKey).not.toContain("refresh");
    expect(draft.canonicalKey).not.toContain("1234796");
    expect(draft.cooldownSeconds).toBeNull();
  });

  it("prefills deterministic canonical keys for the same input", () => {
    const fskMembership = mergeSimcMembership(
      membershipFromScope("class_spell"),
      membershipFromScope("spec_spell"),
    );
    const input = {
      name: "Flying Serpent Kick",
      primarySpellId: 101545,
      matchedCanonicalKey: null,
      classSlug: "monk",
      specSlugs: ["windwalker"],
      raceSlugs: [] as string[],
      evidence: {
        ownershipKind: "PLAYABLE_PLAYER",
        simcMembership: fskMembership,
        availability: "BASELINE",
      },
      sourceProvenance: {},
      wowBuild: "69299",
    };
    const first = prefillCuratedDraftDefaults(input);
    const second = prefillCuratedDraftDefaults(input);
    expect(first.canonicalKey).toBe("monk.windwalker.flying-serpent-kick");
    expect(second.canonicalKey).toBe(first.canonicalKey);
    expect(first.availability).toBe("BASELINE");
  });

  it("does not let empty create-mode patch erase evidence defaults", () => {
    const base = prefillCuratedDraftDefaults({
      name: "Roll the Bones",
      primarySpellId: 1214909,
      matchedCanonicalKey: null,
      classSlug: "rogue",
      specSlugs: ["outlaw"],
      raceSlugs: [],
      evidence: rollTheBonesEvidence,
      sourceProvenance: {},
      wowBuild: "69299",
    });
    const merged = mergeCuratedDraftInput(
      base,
      {
        availability: null,
        cooldownSeconds: null,
        sourceOwnership: null,
        category: null,
        provenance: { source: null, verifiedAt: null, gameVersion: null },
      },
      "create",
    );
    expect(merged.cooldownSeconds).toBe(45);
    expect(merged.sourceOwnership).toBe("PLAYER");
    expect((merged.provenance as { source?: string }).source).toBe("SIMC_ADVISORY");
  });

  it("extracts candidate evidence fields from diff entries", () => {
    const evidence = candidateEvidenceFromDiffEntry({
      candidateKey: "rogue.refresh.roll-the-bones-1214909",
      cooldownSeconds: 45,
      ownershipKind: "PLAYABLE_PLAYER",
      availability: "BASELINE",
      simcMembership: membershipFromScope("class_spell"),
      candidateBindings: [{ spellId: 1214909, role: "PRIMARY_ACTIVATION" }],
    });
    expect(evidence.cooldownSeconds).toBe(45);
    expect(evidence.availability).toBe("BASELINE");
    expect(evidence.simcMembership).toEqual(membershipFromScope("class_spell"));
    expect(evidence.candidateBindings).toEqual([
      { spellId: 1214909, role: "PRIMARY_ACTIVATION" },
    ]);
  });

  it("prefers Blizzard provenance when SimC is absent", () => {
    const provenance = provenanceFromRefreshEvidence({
      sourceProvenance: {
        sourceObservations: [
          {
            source: "BLIZZARD",
            state: "IDENTITY_ONLY",
            identity: {
              source: "BLIZZARD",
              datasetKind: "PINNED",
              sourceVersion: "wow-game-data",
              sourceRevision: "69299",
              retrievedAt: "2026-08-16T12:00:00.000Z",
              blizzardNamespace: "static-eu",
              captureProvenance: "REAL_CAPTURE",
            },
          },
        ],
      },
      evidence: {},
      wowBuild: "69299",
    });
    expect(provenance.source).toBe("BLIZZARD_API");
  });
});

describe("parseCandidateBindings curated projection", () => {
  it("collapses duplicate logical bindings from multiple source observations", () => {
    expect(
      parseCandidateBindings([
        { spellId: 101545, role: "PRIMARY_ACTIVATION", source: "SIMULATIONCRAFT" },
        { spellId: 101545, role: "PRIMARY_ACTIVATION", source: "BLIZZARD" },
      ]),
    ).toEqual([{ spellId: 101545, role: "PRIMARY_ACTIVATION" }]);
  });

  it("preserves different roles for the same spell id", () => {
    expect(
      parseCandidateBindings([
        { spellId: 101545, role: "PRIMARY_ACTIVATION" },
        { spellId: 101545, role: "TRIGGERED_EFFECT" },
      ]),
    ).toEqual([
      { spellId: 101545, role: "PRIMARY_ACTIVATION" },
      { spellId: 101545, role: "TRIGGERED_EFFECT" },
    ]);
  });

  it("does not collapse different primary spell ids", () => {
    const bindings = parseCandidateBindings([
      { spellId: 101545, role: "PRIMARY_ACTIVATION" },
      { spellId: 999999, role: "PRIMARY_ACTIVATION" },
    ]);
    expect(bindings).toEqual([
      { spellId: 101545, role: "PRIMARY_ACTIVATION" },
      { spellId: 999999, role: "PRIMARY_ACTIVATION" },
    ]);
    const validation = validateCuratedDraftRule({
      canonicalKey: "monk.windwalker.flying-serpent-kick",
      name: "Flying Serpent Kick",
      spellIds: [101545, 999999],
      bindings,
      category: "MOVEMENT_UTILITY",
      availability: "BASELINE",
      provenance: {
        source: "SIMC_ADVISORY",
        verifiedAt: "2026-08-30T00:00:00.000Z",
        gameVersion: "69299",
      },
    });
    expect(validation.errors.some((issue) => issue.code === "MULTIPLE_PRIMARY_BINDING")).toBe(true);
    expect(validation.errors.some((issue) => issue.code === "DUPLICATE_BINDING")).toBe(false);
  });

  it("prefills and validates Flying Serpent Kick from sync-shaped duplicate evidence", () => {
    const fskMembership = mergeSimcMembership(
      membershipFromScope("class_spell"),
      membershipFromScope("spec_spell"),
    );
    const evidence = {
      status: "MISSING_FROM_CURRENT_CATALOG",
      candidateKey: "monk.refresh.flying-serpent-kick-101545",
      ownershipKind: "PLAYABLE_PLAYER",
      cooldownSeconds: 30,
      validFromBuild: "69299",
      availability: "BASELINE",
      simcMembership: fskMembership,
      candidateBindings: [
        { spellId: 101545, role: "PRIMARY_ACTIVATION" },
        { spellId: 101545, role: "PRIMARY_ACTIVATION" },
      ],
      sourceObservations: [
        {
          source: "BLIZZARD",
          state: "IDENTITY_ONLY",
          identity: {
            source: "BLIZZARD",
            datasetKind: "PINNED",
            sourceRevision: "69299",
            retrievedAt: "2026-08-30T10:45:51.144Z",
            captureProvenance: "REAL_CAPTURE",
          },
        },
        {
          source: "SIMULATIONCRAFT",
          state: "PRESENT",
          identity: {
            source: "SIMULATIONCRAFT",
            datasetKind: "PINNED",
            sourceRevision: "a060a35",
            retrievedAt: "2026-08-30T10:45:35.119Z",
            validFromBuild: "69299",
            captureProvenance: "REAL_CAPTURE",
          },
        },
      ],
    };

    const prefill = prefillCuratedDraftDefaults({
      name: "Flying Serpent Kick",
      primarySpellId: 101545,
      matchedCanonicalKey: null,
      classSlug: "monk",
      specSlugs: ["windwalker"],
      raceSlugs: [],
      evidence,
      sourceProvenance: { sourceObservations: evidence.sourceObservations },
      wowBuild: "69299",
      generatedAt: "2026-08-30T10:45:51.144Z",
    });

    expect(prefill.bindings).toEqual([{ spellId: 101545, role: "PRIMARY_ACTIVATION" }]);
    expect(prefill.availability).toBe("BASELINE");

    const merged = applyBusinessMetadataToReviewDraft(prefill, {
      category: "MOVEMENT_UTILITY",
    });
    const validation = validateCuratedDraftRule(merged);
    expect(validation.errors.some((issue) => issue.code === "DUPLICATE_BINDING")).toBe(false);
    expect(validation.errors.some((issue) => issue.code === "MULTIPLE_PRIMARY_BINDING")).toBe(false);
    expect(validation.readyForPublishReview).toBe(true);
    expect(validation.status).toBe("READY_FOR_PUBLISH_REVIEW");
  });
});
