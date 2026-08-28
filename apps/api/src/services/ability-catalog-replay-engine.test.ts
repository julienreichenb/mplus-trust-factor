/**
 * Phase 3B.3 — catalog release replay engine + corpus tests (no DB required).
 */
import { describe, expect, it } from "vitest";
import {
  CURRENT_CATALOG_VERSION_ID,
  createRulesAbilityCatalogContext,
  createStaticAbilityCatalogContext,
  type AbilityRule,
} from "@mplus/abilities";
import {
  compileAbilityCatalogRelease,
  compileBootstrapRelease0,
  createReleaseAbilityCatalogContext,
  diffReleaseArtifacts,
  type AbilityCatalogReleaseArtifact,
} from "@mplus/abilities/release";
import {
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
  withParticipantDigestContentHash,
  type ParticipantScoringDigestV1,
  type UtilityCanonicalAction,
} from "@mplus/contracts";
import { createHash } from "node:crypto";
import { replayCorpusItems } from "./ability-catalog-replay-engine.js";
import type { AbilityCatalogReplayCorpusSelectionMeta } from "./ability-catalog-replay-types.js";
import type { ReplayCorpusCandidate } from "./ability-catalog-replay-corpus.js";

const SYNTHETIC_SPELL = 88_000_001;

function baseAction(
  overrides: Partial<UtilityCanonicalAction> &
    Pick<UtilityCanonicalAction, "utilityCategory" | "outcome" | "canonicalActionId">,
): UtilityCanonicalAction {
  return {
    abilityKey: "counterspell",
    canonicalName: "Counterspell",
    primarySpellId: 2139,
    observedSpellIds: [2139],
    reportCode: "abc123",
    fightId: 1,
    reportRevision: 1,
    dungeonSlug: "skyreach",
    rawTimestampMs: 10_000,
    fightOffsetMs: 10_000,
    sourceActorId: 10,
    ownerActorId: 10,
    targetActorId: 50,
    sourceCharacterName: "Target",
    targetCharacterName: "Enemy",
    sourceClassSlug: "mage",
    sourceSpecSlug: "fire",
    sourceDataset: "Interrupts",
    evidenceEventTypes: ["interrupt"],
    attributedToPet: false,
    petActorId: null,
    limitations: [],
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    normalizerVersion: "utility-action-normalizer-v1",
    ...overrides,
  };
}

function baseDigest(
  overrides: Partial<Omit<ParticipantScoringDigestV1, "contentHash">> = {},
): ParticipantScoringDigestV1 {
  return withParticipantDigestContentHash({
    schemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
    reportCode: "abc123",
    fightId: 1,
    reportRevision: 1,
    dungeonSlug: "skyreach",
    keyLevel: 15,
    timed: true,
    runScore: 400,
    completedAt: "2026-07-01T12:00:00.000Z",
    participantActorId: 10,
    characterId: null,
    characterName: "Target",
    realmSlug: "archimonde",
    regionCode: "EU",
    classSlug: "mage",
    specSlug: "fire",
    role: "DPS",
    ownedPetActorIds: [],
    loadoutEvidence: {
      evidenceState: "ABSENT",
      talentSpellIds: [],
      talentTreeNodeIds: [],
      blizzardSpecId: null,
      source: "ABSENT",
      raceSlug: null,
      raceEvidenceState: "UNKNOWN",
    },
    capabilityPackageArtifactId: "pkg-1",
    capabilityPackageContentHash: "a".repeat(32),
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
    performance: {
      parsePercentile: 80,
      parseSemantic: "BRACKET_PERCENT",
      partition: null,
      rawDps: null,
      offensiveActivations: [],
      activeCombatMs: 1_500_000,
      activeCombatMethod: "fight_duration_fallback",
      completeness: "COMPLETE",
      limitations: [],
    },
    utility: {
      hostileCastEvents: [],
      actions: [
        baseAction({
          canonicalActionId: "kick-1",
          utilityCategory: "INTERRUPT",
          outcome: "SUCCESS",
        }),
      ],
      capabilityCompleteness: [
        {
          capability: "UTILITY_INTERRUPTS",
          status: "COMPLETE",
          requiredDatasets: ["Interrupts", "Casts"],
          presentDatasets: ["Interrupts", "Casts"],
          incompleteDatasets: [],
          limitations: [],
        },
      ],
      completeness: "COMPLETE",
      limitations: [],
    },
    survival: {
      damageTakenTotal: 1000,
      damageTakenEventCount: 10,
      deaths: [],
      personalDefensiveActivations: [],
      recoveryActivations: [],
      externalsReceived: [],
      pressureWindows: [],
      fightDurationMs: 1_800_000,
      activeCombatMs: 1_500_000,
      capabilityCompleteness: [],
      completeness: "COMPLETE",
      limitations: [],
    },
    createdAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  });
}

function emptyCorpusMeta(selected: number): AbilityCatalogReplayCorpusSelectionMeta {
  return {
    maxPerSpec: 3,
    maxTotal: 120,
    extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
    availableCount: selected,
    selectedCount: selected,
    unsupportedSchemaCount: 0,
    corruptCount: 0,
    expectedSpecCount: 40,
    nativeV4SpecCount: 1,
    derivedSpecCount: 0,
    missingSpecCount: 39,
    corpusCoveragePass: false,
    coverage: {
      classes: { available: ["mage"], selected: ["mage"], missing: [] },
      specs: {
        available: [{ classSlug: "mage", specSlug: "fire", role: "DPS" }],
        selected: [{ classSlug: "mage", specSlug: "fire", role: "DPS" }],
        missing: [],
        expected: [{ classSlug: "mage", specSlug: "fire", role: "DPS" }],
        nativeV4: ["mage/fire"],
        derived: [],
      },
      perSpecStatus: [
        {
          classSlug: "mage",
          specSlug: "fire",
          role: "DPS",
          status: "AVAILABLE_NATIVE_V4",
        },
      ],
      roles: {
        available: ["DPS"],
        selected: ["DPS"],
        missing: ["TANK", "HEALER"],
        diversity: [{ role: "DPS", distinctSpecs: 1, specs: ["mage/fire"] }],
      },
      racialEvidenceSelected: 0,
      offensiveCooldownEvidenceSelected: 0,
      defensiveCooldownEvidenceSelected: 0,
      utilityInterruptEvidenceSelected: 1,
      unknownSpellIdEvidenceSelected: 0,
      sparseAbilityEvidenceSelected: 0,
      aliasSpellIdEvidenceSelected: 0,
    },
    note: "Fixture corpus — not fully representative.",
  };
}

function toItem(digest: ParticipantScoringDigestV1, id = "digest-1"): ReplayCorpusCandidate {
  return {
    digestRowId: id,
    digest,
    classSlugNorm: "mage",
    specSlugNorm: "fire",
    role: "DPS",
    coverageStatus: "AVAILABLE_NATIVE_V4",
  };
}

function mutateArtifact(
  base: AbilityCatalogReleaseArtifact,
  changes: NonNullable<Parameters<typeof compileAbilityCatalogRelease>[0]["changes"]>,
): AbilityCatalogReleaseArtifact {
  return compileAbilityCatalogRelease({
    baseRules: base.rules,
    baseTopology: base.topology,
    changes,
    wowBuild: base.wowBuild,
    gameVersion: base.gameVersion,
    seasonSlug: base.seasonSlug,
    previousReleaseId: null,
    manifest: {
      origin: "CURATED_RELEASE",
      curatedChangeIds: ["synthetic-test"],
      notes: "synthetic-test-candidate",
    },
    generatedAt: "2026-08-16T00:00:00.000Z",
  });
}

function curatedDiff(
  base: AbilityCatalogReleaseArtifact,
  candidate: AbilityCatalogReleaseArtifact,
) {
  return diffReleaseArtifacts({
    base,
    candidate,
    curationEntries: [],
  });
}

describe("ability catalog replay engine", () => {
  const bootstrap = compileBootstrapRelease0();
  const baseCtx = createReleaseAbilityCatalogContext({ artifact: bootstrap.artifact });
  const staticCtx = createStaticAbilityCatalogContext();

  it("base == candidate → zero impact", () => {
    const digest = baseDigest();
    const report = replayCorpusItems({
      items: [toItem(digest)],
      baseCatalog: baseCtx,
      candidateCatalog: baseCtx,
      corpusMeta: emptyCorpusMeta(1),
      corpusDigest: "c".repeat(64),
      baseMeta: {
        kind: "RELEASE",
        releaseId: "base",
        releaseKey: bootstrap.artifact.releaseKey,
        contentDigest: bootstrap.artifact.contentDigest,
      },
      candidateMeta: {
        releaseId: "cand",
        releaseKey: bootstrap.artifact.releaseKey,
        contentDigest: bootstrap.artifact.contentDigest,
      },
      releaseDiff: { kind: "BOOTSTRAP", entries: [] },
      expectZeroImpact: true,
    });
    expect(report.status).toBe("PASSED");
    expect(report.summary.changedAnalyses).toBe(0);
    expect(report.summary.utilityChanged).toBe(0);
    expect(report.summary.experienceChanged).toBe(0);
    expect(report.summary.boostChanged).toBe(0);
    expect(report.summary.trustReplayStatus).toBe("TRUST_REPLAY_UNAVAILABLE");
  });

  it("static vs bootstrap → zero impact", () => {
    const digest = baseDigest();
    const report = replayCorpusItems({
      items: [toItem(digest)],
      baseCatalog: staticCtx,
      candidateCatalog: baseCtx,
      corpusMeta: emptyCorpusMeta(1),
      corpusDigest: "d".repeat(64),
      baseMeta: {
        kind: "STATIC",
        releaseId: null,
        releaseKey: null,
        contentDigest: null,
        catalogVersion: CURRENT_CATALOG_VERSION_ID,
      },
      candidateMeta: {
        releaseId: "boot",
        releaseKey: bootstrap.artifact.releaseKey,
        contentDigest: bootstrap.artifact.contentDigest,
      },
      releaseDiff: { kind: "BOOTSTRAP", entries: [] },
      expectZeroImpact: true,
    });
    expect(report.status).toBe("PASSED");
    expect(report.summary.changedAnalyses).toBe(0);
  });

  it("ADD_RULE observed spell → recognition impact", () => {
    const digest = baseDigest({
      utility: {
        hostileCastEvents: [],
        actions: [
          baseAction({
            canonicalActionId: "new-1",
            utilityCategory: "INTERRUPT",
            outcome: "SUCCESS",
            primarySpellId: SYNTHETIC_SPELL,
            observedSpellIds: [SYNTHETIC_SPELL],
          }),
        ],
        capabilityCompleteness: [
          {
            capability: "UTILITY_INTERRUPTS",
            status: "COMPLETE",
            requiredDatasets: ["Interrupts", "Casts"],
            presentDatasets: ["Interrupts", "Casts"],
            incompleteDatasets: [],
            limitations: [],
          },
        ],
        completeness: "COMPLETE",
        limitations: [],
      },
    });

    const newRule: AbilityRule = {
      canonicalKey: "mage.fire.synthetic-interrupt",
      name: "Synthetic Interrupt",
      spellIds: [SYNTHETIC_SPELL],
      classSlug: "mage",
      specSlugs: ["fire"],
      roles: ["DPS"],
      category: "INTERRUPT",
      dimensionTags: ["UTILITY"],
      sourceOwnership: "PLAYER",
      sharedAcrossSpecs: false,
      availability: "BASELINE",
      provenance: {
        source: "CURATED_OVERRIDE",
        verifiedAt: "2026-08-16T00:00:00.000Z",
        certainty: "confirmed",
      },
    };

    const candidateArtifact = mutateArtifact(bootstrap.artifact, [
      { op: "ADD_RULE", rule: newRule },
    ]);
    const candidateCtx = createReleaseAbilityCatalogContext({
      artifact: candidateArtifact,
    });
    const diff = curatedDiff(bootstrap.artifact, candidateArtifact);

    const report = replayCorpusItems({
      items: [toItem(digest)],
      baseCatalog: baseCtx,
      candidateCatalog: candidateCtx,
      corpusMeta: emptyCorpusMeta(1),
      corpusDigest: "e".repeat(64),
      baseMeta: {
        kind: "RELEASE",
        releaseId: "base",
        releaseKey: bootstrap.artifact.releaseKey,
        contentDigest: bootstrap.artifact.contentDigest,
      },
      candidateMeta: {
        releaseId: "cand",
        releaseKey: candidateArtifact.releaseKey,
        contentDigest: candidateArtifact.contentDigest,
      },
      releaseDiff: diff,
      expectZeroImpact: false,
    });

    expect(report.summary.becameRecognized).toBeGreaterThan(0);
    expect(report.details[0]?.resolutionDiffs.some((d) => d.changeKind === "BECAME_RECOGNIZED")).toBe(
      true,
    );
    expect(report.status).toBe("PASSED");
  });

  it("ADD_RULE unused in corpus → zero score impact", () => {
    const digest = baseDigest();
    const newRule: AbilityRule = {
      canonicalKey: "mage.fire.unused-synth",
      name: "Unused",
      spellIds: [SYNTHETIC_SPELL + 1],
      classSlug: "mage",
      specSlugs: ["fire"],
      roles: ["DPS"],
      category: "INTERRUPT",
      dimensionTags: ["UTILITY"],
      sourceOwnership: "PLAYER",
      sharedAcrossSpecs: false,
      availability: "BASELINE",
      provenance: {
        source: "CURATED_OVERRIDE",
        verifiedAt: "2026-08-16T00:00:00.000Z",
        certainty: "confirmed",
      },
    };
    const candidateArtifact = mutateArtifact(bootstrap.artifact, [
      { op: "ADD_RULE", rule: newRule },
    ]);
    const report = replayCorpusItems({
      items: [toItem(digest)],
      baseCatalog: baseCtx,
      candidateCatalog: createReleaseAbilityCatalogContext({ artifact: candidateArtifact }),
      corpusMeta: emptyCorpusMeta(1),
      corpusDigest: "f".repeat(64),
      baseMeta: {
        kind: "RELEASE",
        releaseId: "base",
        releaseKey: bootstrap.artifact.releaseKey,
        contentDigest: bootstrap.artifact.contentDigest,
      },
      candidateMeta: {
        releaseId: "cand",
        releaseKey: candidateArtifact.releaseKey,
        contentDigest: candidateArtifact.contentDigest,
      },
      releaseDiff: curatedDiff(bootstrap.artifact, candidateArtifact),
      expectZeroImpact: false,
    });
    expect(report.summary.utilityChanged).toBe(0);
    expect(report.summary.becameRecognized).toBe(0);
  });

  it("TOMBSTONE used interrupt → became unrecognized", () => {
    const kick = baseCtx.resolveBySpellId({
      spellId: 2139,
      classSlug: "mage",
      specSlug: "fire",
    });
    expect(kick.status).toBe("matched");
    if (kick.status !== "matched") return;

    const candidateArtifact = mutateArtifact(bootstrap.artifact, [
      { op: "TOMBSTONE_RULE", canonicalKey: kick.rule.canonicalKey, validToBuild: "99999" },
    ]);
    const digest = baseDigest();
    const report = replayCorpusItems({
      items: [toItem(digest)],
      baseCatalog: baseCtx,
      candidateCatalog: createReleaseAbilityCatalogContext({ artifact: candidateArtifact }),
      corpusMeta: emptyCorpusMeta(1),
      corpusDigest: "g".repeat(64),
      baseMeta: {
        kind: "RELEASE",
        releaseId: "base",
        releaseKey: bootstrap.artifact.releaseKey,
        contentDigest: bootstrap.artifact.contentDigest,
      },
      candidateMeta: {
        releaseId: "cand",
        releaseKey: candidateArtifact.releaseKey,
        contentDigest: candidateArtifact.contentDigest,
      },
      releaseDiff: curatedDiff(bootstrap.artifact, candidateArtifact),
      expectZeroImpact: false,
    });
    expect(report.summary.becameUnrecognized).toBeGreaterThan(0);
  });

  it("BINDING_CHANGED → resolution change", () => {
    const kick = baseCtx.resolveBySpellId({
      spellId: 2139,
      classSlug: "mage",
      specSlug: "fire",
    });
    expect(kick.status).toBe("matched");
    if (kick.status !== "matched") return;
    const updated: AbilityRule = {
      ...kick.rule,
      aliases: [...(kick.rule.aliases ?? []), SYNTHETIC_SPELL + 2],
    };
    const candidateArtifact = mutateArtifact(bootstrap.artifact, [
      { op: "UPDATE_RULE", canonicalKey: kick.rule.canonicalKey, rule: updated },
    ]);
    const digest = baseDigest({
      utility: {
        hostileCastEvents: [],
        actions: [
          baseAction({
            canonicalActionId: "alias-hit",
            utilityCategory: "INTERRUPT",
            outcome: "SUCCESS",
            primarySpellId: SYNTHETIC_SPELL + 2,
            observedSpellIds: [SYNTHETIC_SPELL + 2],
          }),
        ],
        capabilityCompleteness: [
          {
            capability: "UTILITY_INTERRUPTS",
            status: "COMPLETE",
            requiredDatasets: ["Interrupts"],
            presentDatasets: ["Interrupts"],
            incompleteDatasets: [],
            limitations: [],
          },
        ],
        completeness: "COMPLETE",
        limitations: [],
      },
    });
    const report = replayCorpusItems({
      items: [toItem(digest)],
      baseCatalog: baseCtx,
      candidateCatalog: createReleaseAbilityCatalogContext({ artifact: candidateArtifact }),
      corpusMeta: emptyCorpusMeta(1),
      corpusDigest: "h".repeat(64),
      baseMeta: {
        kind: "RELEASE",
        releaseId: "base",
        releaseKey: bootstrap.artifact.releaseKey,
        contentDigest: bootstrap.artifact.contentDigest,
      },
      candidateMeta: {
        releaseId: "cand",
        releaseKey: candidateArtifact.releaseKey,
        contentDigest: candidateArtifact.contentDigest,
      },
      releaseDiff: curatedDiff(bootstrap.artifact, candidateArtifact),
      expectZeroImpact: false,
    });
    expect(report.summary.becameRecognized).toBeGreaterThan(0);
  });

  it("category change is detected", () => {
    const kick = baseCtx.resolveBySpellId({
      spellId: 2139,
      classSlug: "mage",
      specSlug: "fire",
    });
    expect(kick.status).toBe("matched");
    if (kick.status !== "matched") return;
    const updated: AbilityRule = {
      ...kick.rule,
      category: "HARD_CC",
    };
    const candidateArtifact = mutateArtifact(bootstrap.artifact, [
      { op: "UPDATE_RULE", canonicalKey: kick.rule.canonicalKey, rule: updated },
    ]);
    const report = replayCorpusItems({
      items: [toItem(baseDigest())],
      baseCatalog: baseCtx,
      candidateCatalog: createReleaseAbilityCatalogContext({ artifact: candidateArtifact }),
      corpusMeta: emptyCorpusMeta(1),
      corpusDigest: "i".repeat(64),
      baseMeta: {
        kind: "RELEASE",
        releaseId: "base",
        releaseKey: bootstrap.artifact.releaseKey,
        contentDigest: bootstrap.artifact.contentDigest,
      },
      candidateMeta: {
        releaseId: "cand",
        releaseKey: candidateArtifact.releaseKey,
        contentDigest: candidateArtifact.contentDigest,
      },
      releaseDiff: curatedDiff(bootstrap.artifact, candidateArtifact),
      expectZeroImpact: false,
    });
    expect(
      report.details.some((d) =>
        d.resolutionDiffs.some((r) => r.changeKind === "CATEGORY_CHANGED"),
      ),
    ).toBe(true);
  });

  it("deterministic semantic digests for identical replays", () => {
    const digest = baseDigest();
    const mk = () =>
      replayCorpusItems({
        items: [toItem(digest)],
        baseCatalog: baseCtx,
        candidateCatalog: baseCtx,
        corpusMeta: emptyCorpusMeta(1),
        corpusDigest: "j".repeat(64),
        baseMeta: {
          kind: "RELEASE",
          releaseId: "base",
          releaseKey: bootstrap.artifact.releaseKey,
          contentDigest: bootstrap.artifact.contentDigest,
        },
        candidateMeta: {
          releaseId: "cand",
          releaseKey: bootstrap.artifact.releaseKey,
          contentDigest: bootstrap.artifact.contentDigest,
        },
        releaseDiff: { kind: "BOOTSTRAP", entries: [] },
        expectZeroImpact: true,
      });
    const a = mk();
    const b = mk();
    expect(a.replayInputDigest).toBe(b.replayInputDigest);
    expect(a.summary.changedAnalyses).toBe(b.summary.changedAnalyses);
    expect(a.summary.exactMatches).toBe(b.summary.exactMatches);
  });

  it("Experience and Boost remain invariant markers", () => {
    const report = replayCorpusItems({
      items: [toItem(baseDigest())],
      baseCatalog: staticCtx,
      candidateCatalog: createRulesAbilityCatalogContext({
        identity: {
          kind: "release",
          releaseKey: "x",
          contentDigest: createHash("sha256").update("x").digest("hex"),
        },
        rules: [],
        topology: { classes: [], races: [] },
      }),
      corpusMeta: emptyCorpusMeta(1),
      corpusDigest: "k".repeat(64),
      baseMeta: {
        kind: "STATIC",
        releaseId: null,
        releaseKey: null,
        contentDigest: null,
        catalogVersion: CURRENT_CATALOG_VERSION_ID,
      },
      candidateMeta: {
        releaseId: "empty",
        releaseKey: "x",
        contentDigest: createHash("sha256").update("x").digest("hex"),
      },
      releaseDiff: null,
      expectZeroImpact: false,
    });
    expect(report.summary.experienceChanged).toBe(0);
    expect(report.summary.boostChanged).toBe(0);
    expect(report.details[0]?.scoresAfter.experience).toBe("INVARIANT_UNAFFECTED");
    expect(report.details[0]?.scoresAfter.boost).toBe("INVARIANT_UNAFFECTED");
  });
});
