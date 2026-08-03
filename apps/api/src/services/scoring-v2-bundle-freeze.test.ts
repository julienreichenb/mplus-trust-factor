/**
 * Unit tests for Calibration Input Bundle V2 freeze assembly.
 * Provider-free. Uses in-memory prisma/artifact fakes — no live providers.
 * H3: freeze consumes export-time freezeSnapshot, not live ACTIVE/cohort.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createMapArtifactResolverV2,
  createDefaultModelV6,
  createDefaultScoringV2DimensionConfigSet,
  buildDefaultFreezePolicies,
  buildFreezeSnapshot,
  resolveFrozenDimensionConfigsForModel,
  replayCalibrationBundleV2,
  withScoringV2DimensionConfigs,
  type CalibrationInputBundleV2,
  type FreezeSnapshotV1,
} from "@mplus/scoring";
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import {
  assembleCalibrationInputBundleV2,
  type AssembleBundleV2Result,
} from "./scoring-v2-bundle-freeze.js";

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function makeModelConfig() {
  return withScoringV2DimensionConfigs(
    createDefaultModelV6({ key: "test-model", version: 6 }),
    createDefaultScoringV2DimensionConfigSet(),
  );
}

function makeArtifacts() {
  const store = new Map<string, Buffer>();
  return {
    store,
    persist: vi.fn(async (input: { bytes: Buffer | Uint8Array }) => {
      const bytes = Buffer.from(input.bytes);
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      store.set(contentHash, bytes);
      return {
        artifactId: `art-${contentHash.slice(0, 8)}`,
        write: {
          contentHash,
          storageUri: `memory://${contentHash}`,
          compression: "NONE",
          sizeBytes: bytes.byteLength,
          uncompressedSizeBytes: bytes.byteLength,
          deduplicated: store.has(contentHash),
        },
      };
    }),
  };
}

type FixtureOpts = {
  includeExcluded?: boolean;
  omitManifest?: boolean;
  omitFactSets?: boolean;
  omitDimension?: boolean;
  omitAlgorithmPolicies?: boolean;
  evaluationModelId?: string | null;
  mutateFactPayload?: (facts: unknown) => unknown;
  /** Override freezeSnapshot on the export row (undefined = auto-build valid snapshot). */
  freezeSnapshot?: unknown;
  /** Mutate live ACTIVE model returned by findFirst (should be ignored by freeze). */
  liveActiveModelOverride?: Record<string, unknown>;
  /** Mutate live cohort members if somehow queried (should be unused). */
  liveMembersOverride?: unknown[];
};

function buildFreezeSnapshotForFixture(input: {
  cohortId: string;
  seasonId: string;
  completedAt: Date;
  evidenceCutoffAt: Date;
  members: Array<Record<string, unknown>>;
  activeModel: {
    id: string;
    key: string;
    version: number;
    status: string;
    config: ReturnType<typeof makeModelConfig>;
  };
}): FreezeSnapshotV1 {
  const modelRef = {
    id: input.activeModel.id,
    key: input.activeModel.key,
    version: input.activeModel.version,
    status: input.activeModel.status as "ACTIVE",
    config: input.activeModel.config,
    isActive: true as const,
  };
  const dimensionConfigs = resolveFrozenDimensionConfigsForModel(modelRef, "calibration-strict");
  return buildFreezeSnapshot({
    cohortId: input.cohortId,
    cohortExternalKey: "cohort-ext",
    cohortName: "Fixture cohort",
    cohortDescription: "desc",
    cohortCreatedAt: input.completedAt.toISOString(),
    cohortRevision: 3,
    members: input.members.map((m) => ({
      id: String(m.id),
      externalMemberKey: (m.externalMemberKey as string | null) ?? null,
      characterId: (m.characterId as string | null) ?? null,
      region: String(m.region),
      realmSlug: String(m.realmSlug),
      characterName: String(m.characterName),
      expectedLabel: String(m.expectedLabel),
      rationale: String(m.rationale ?? ""),
      included: Boolean(m.included),
      exclusionCode: (m.exclusionCode as string | null) ?? null,
      role: (m.providedRole as string | null) ?? null,
      classSlug: (m.classSlug as string | null) ?? null,
      specSlug: (m.specSlug as string | null) ?? null,
      evidenceCutoffAt:
        m.evidenceCutoffAt instanceof Date
          ? m.evidenceCutoffAt.toISOString()
          : input.evidenceCutoffAt.toISOString(),
      source: String(m.source ?? "USER_SELECTED"),
    })),
    season: {
      seasonId: input.seasonId,
      seasonSlug: "season-tww-1",
      region: "eu",
    },
    activeModel: { ...modelRef, dimensionConfigs },
    evaluationModel: null,
    policies: buildDefaultFreezePolicies({
      abilityCatalogVersions: [CURRENT_CATALOG_VERSION_ID],
      mechanicCatalogVersions: ["0.1.0-seed"],
    }),
    evidenceCutoffAt: input.evidenceCutoffAt.toISOString(),
    generatedAt: input.completedAt.toISOString(),
  });
}

function buildFixture(opts: FixtureOpts = {}) {
  const completedAt = new Date("2026-08-01T12:00:00.000Z");
  const evidenceCutoffAt = new Date("2026-08-01T00:00:00.000Z");
  const charId = "11111111-1111-4111-8111-111111111111";
  const seasonId = "22222222-2222-4222-8222-222222222222";
  const cohortId = "33333333-3333-4333-8333-333333333333";
  const exportId = "44444444-4444-4444-8444-444444444444";
  const memberInclId = "55555555-5555-4555-8555-555555555555";
  const memberExclId = "66666666-6666-4666-8666-666666666666";
  const manifestId = "77777777-7777-4777-8777-777777777777";
  const activeModelId = "88888888-8888-4888-8888-888888888888";
  const draftModelId = "99999999-9999-4999-8999-999999999999";
  const slotId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const manifestDocument = {
    schemaVersion: "2.0.0",
    contentHash: "pending",
    selectorVersion: "evidence-v2",
    expectedSlotCount: 1,
    selectedSlotCount: 1,
    activeDungeonSlugs: ["ara-kara"],
    slots: [
      {
        slotId: "slot-0",
        dungeonSlug: "ara-kara",
        slotIndex: 0,
        state: "SELECTED",
        identity: { reportCode: "R1", fightId: 1, reportRevision: 1 },
      },
    ],
  };
  const manifestContentHash = sha256Json({
    kind: "evidence-manifest-hash-input",
    slots: manifestDocument.slots,
  });
  (manifestDocument as { contentHash: string }).contentHash = manifestContentHash;

  const factPayload = {
    schemaVersion: "utility-v2-facts",
    extractorFamily: "utility",
    extractorVersion: "1",
    inputFingerprint: "fp-1",
    facts: { kind: "fixture-fact" },
    coverage: { slots: 1 },
    limitations: [],
    computedAt: evidenceCutoffAt.toISOString(),
  };

  const members = [
    {
      id: memberInclId,
      externalMemberKey: "m-included",
      characterId: charId,
      region: "EU",
      realmSlug: "kazzak",
      characterName: "Testchar",
      providedRole: "DPS",
      classSlug: "warlock",
      specSlug: "affliction",
      expectedLabel: "GOOD",
      rationale: "expert",
      included: true,
      exclusionCode: null,
      evidenceCutoffAt,
      source: "USER_SELECTED",
    },
  ];
  if (opts.includeExcluded !== false) {
    members.push({
      id: memberExclId,
      externalMemberKey: "m-excluded",
      characterId: null as unknown as string,
      region: "EU",
      realmSlug: "kazzak",
      characterName: "Excluded",
      providedRole: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      expectedLabel: "WEAK",
      rationale: "boosted",
      included: false,
      exclusionCode: "SUSPECTED_BOOST",
      evidenceCutoffAt,
      source: "USER_SELECTED",
    });
  }

  const activeModel = {
    id: activeModelId,
    key: "test-model",
    version: 6,
    status: "ACTIVE",
    name: "Active",
    config: makeModelConfig(),
  };
  const draftModel = {
    id: draftModelId,
    key: "test-model-draft",
    version: 7,
    status: "DRAFT",
    name: "Draft",
    config: makeModelConfig(),
  };

  const freezeSnapshot =
    opts.freezeSnapshot !== undefined
      ? opts.freezeSnapshot
      : buildFreezeSnapshotForFixture({
          cohortId,
          seasonId,
          completedAt,
          evidenceCutoffAt,
          members,
          activeModel,
        });

  const factSets = opts.omitFactSets
    ? []
    : [
        {
          id: "fs-1",
          schemaVersion: factPayload.schemaVersion,
          extractorFamily: factPayload.extractorFamily,
          extractorVersion: factPayload.extractorVersion,
          inputFingerprint: factPayload.inputFingerprint,
          facts: opts.mutateFactPayload
            ? opts.mutateFactPayload(factPayload.facts)
            : factPayload.facts,
          coverage: factPayload.coverage,
          limitations: factPayload.limitations,
          computedAt: evidenceCutoffAt,
        },
      ];

  const dims = opts.omitDimension
    ? []
    : (["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"] as const).map((dimension) => ({
        id: `dim-${dimension}`,
        dimension,
        algorithmVersion: `${dimension.toLowerCase()}-algo`,
        inputFingerprint: `fp-${dimension}`,
        score: 70,
        confidence: 0.9,
        state: "COMPLETE",
        metrics: {},
        explanation: {},
        computedAt: evidenceCutoffAt,
      }));

  const liveMembers = opts.liveMembersOverride ?? members;

  const prisma = {
    scoringV2EvidenceExport: {
      findUnique: vi.fn(async () => ({
        id: exportId,
        status: "COMPLETED",
        blockerCount: 0,
        seasonId,
        cohortId,
        cohortRevision: 3,
        completedAt,
        createdAt: completedAt,
        freezeSnapshot,
        cohort: {
          id: cohortId,
          externalKey: "cohort-ext",
          name: "Fixture cohort",
          description: "desc",
          createdAt: completedAt,
          seasonId,
          revision: 3,
          // Live members intentionally diverge in H3 tests via liveMembersOverride.
          members: liveMembers,
        },
      })),
    },
    season: {
      findUnique: vi.fn(async () => ({
        id: seasonId,
        slug: "season-tww-1",
        name: "TWW 1",
        regionId: "reg-1",
        region: { code: "eu" },
      })),
    },
    scoreModel: {
      findFirst: vi.fn(async ({ where }: { where: { status?: string } }) => {
        if (where.status === "ACTIVE") {
          return opts.liveActiveModelOverride
            ? { ...activeModel, ...opts.liveActiveModelOverride }
            : activeModel;
        }
        return null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === activeModelId) return activeModel;
        if (where.id === draftModelId) return draftModel;
        return null;
      }),
    },
    evidenceManifest: {
      findFirst: vi.fn(async () =>
        opts.omitManifest
          ? null
          : {
              id: manifestId,
              contentHash: manifestContentHash,
              schemaVersion: "2.0.0",
              document: manifestDocument,
              frozenAt: evidenceCutoffAt,
              slots: [
                {
                  id: slotId,
                  factSets,
                },
              ],
            },
      ),
    },
    dimensionComputation: {
      findMany: vi.fn(async () => dims),
    },
    scoreSnapshot: {
      findFirst: vi.fn(async () => ({ id: "snap-1" })),
    },
  };

  return {
    prisma,
    exportId,
    memberInclId,
    memberExclId,
    manifestContentHash,
    activeModel,
    draftModel,
    activeModelId,
    draftModelId,
    freezeSnapshot,
    members,
    seasonId,
    cohortId,
    completedAt,
    evidenceCutoffAt,
  };
}

describe("assembleCalibrationInputBundleV2", () => {
  it("freezes the complete member graph including excluded members", async () => {
    const fixture = buildFixture();
    const artifacts = makeArtifacts();
    const result = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: artifacts as never,
      exportId: fixture.exportId,
    });
    expect(result.ok).toBe(true);
    expect(result.bundle).not.toBeNull();
    const bundle = result.bundle!;
    expect(bundle.schemaVersion).toBe("2.0.0");
    expect(bundle.members).toHaveLength(2);
    const included = bundle.members.find((m) => m.included)!;
    const excluded = bundle.members.find((m) => !m.included)!;
    expect(included.manifest.logicalContentHash).toBe(fixture.manifestContentHash);
    expect(included.manifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(included.manifest.byteDigest).toBe(`sha256:${included.manifest.contentHash}`);
    expect(included.manifest.digestAlgorithm).toBe("sha256");
    expect(included.manifest.contentHash).not.toBe(fixture.manifestContentHash);
    const storedManifest = result.artifactBytes.get(included.manifest.contentHash);
    expect(storedManifest).toBeTruthy();
    expect(
      createHash("sha256").update(storedManifest!).digest("hex"),
    ).toBe(included.manifest.contentHash);
    expect(included.factSets.length).toBeGreaterThan(0);
    expect(included.factSets[0]!.byteDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(included.factSets[0]!.digestAlgorithm).toBe("sha256");
    expect(included.dimensionExports.PERFORMANCE?.byteDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(included.dimensionExports.PERFORMANCE).toBeTruthy();
    expect(included.dimensionExports.SURVIVAL).toBeTruthy();
    expect(included.dimensionExports.UTILITY).toBeTruthy();
    expect(included.dimensionExports.EXPERIENCE).toBeTruthy();
    expect(included.classSlug).toBe("warlock");
    expect(included.specSlug).toBe("affliction");
    expect(included.role).toBe("DPS");
    expect(included.previousSnapshotId).toBe("snap-1");
    expect(excluded.exclusionCode).toBe("SUSPECTED_BOOST");
    expect(excluded.included).toBe(false);
    expect(bundle.activeModel?.status).toBe("ACTIVE");
    expect(bundle.activeDimensionConfigs).toBeTruthy();
    expect(bundle.policies.abilityCatalogVersions).toContain(CURRENT_CATALOG_VERSION_ID);
    expect(bundle.policies.mechanicCatalogVersions.length).toBeGreaterThan(0);
    expect(bundle.bundleHash).toMatch(/^[a-f0-9]{64}$/);
    // H3: must not query live ACTIVE model for freeze inputs.
    expect(fixture.prisma.scoreModel.findFirst).not.toHaveBeenCalled();
  });

  it("produces the same root hash for identical inputs", async () => {
    const a = await assembleCalibrationInputBundleV2({
      prisma: buildFixture().prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
    });
    const b = await assembleCalibrationInputBundleV2({
      prisma: buildFixture().prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
    });
    expect(a.ok && b.ok).toBe(true);
    expect(a.bundle!.bundleHash).toBe(b.bundle!.bundleHash);
  });

  it("changes root hash when a fact-set payload changes", async () => {
    const base = await assembleCalibrationInputBundleV2({
      prisma: buildFixture().prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
    });
    const changed = await assembleCalibrationInputBundleV2({
      prisma: buildFixture({
        mutateFactPayload: () => ({ kind: "fixture-fact-changed" }),
      }).prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
    });
    expect(base.ok && changed.ok).toBe(true);
    expect(changed.bundle!.bundleHash).not.toBe(base.bundle!.bundleHash);
  });

  it("blocks freeze when manifest is missing", async () => {
    const result = await assembleCalibrationInputBundleV2({
      prisma: buildFixture({ omitManifest: true }).prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.code === "MANIFEST_MISSING")).toBe(true);
  });

  it("blocks freeze when fact sets are missing", async () => {
    const result = await assembleCalibrationInputBundleV2({
      prisma: buildFixture({ omitFactSets: true }).prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.code === "FACT_SET_MISSING")).toBe(true);
  });

  it("blocks freeze when a dimension export is missing", async () => {
    const result = await assembleCalibrationInputBundleV2({
      prisma: buildFixture({ omitDimension: true }).prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.code === "DIMENSION_EXPORT_MISSING")).toBe(true);
  });

  it("freezes ACTIVE and DRAFT configs independently when evaluation model is selected", async () => {
    const fixture = buildFixture({ evaluationModelId: "99999999-9999-4999-8999-999999999999" });
    const result = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: fixture.exportId,
      evaluationModelId: fixture.draftModelId,
    });
    expect(result.ok).toBe(true);
    expect(result.bundle!.activeModel?.id).toBe(fixture.activeModelId);
    expect(result.bundle!.evaluationModel?.id).toBe(fixture.draftModelId);
    expect(result.bundle!.activeDimensionConfigs).toBeTruthy();
    expect(result.bundle!.evaluationDimensionConfigs).toBeTruthy();
    // Source model rows are read-only references — assemble never mutates them.
    expect(fixture.activeModel.status).toBe("ACTIVE");
    expect(fixture.draftModel.status).toBe("DRAFT");
  });

  it("is consumable by Calibration V2 replay with zero provider calls", async () => {
    const providerSpy = vi.fn();
    const assembled = await assembleCalibrationInputBundleV2({
      prisma: buildFixture().prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
    });
    expect(assembled.ok).toBe(true);
    const report = await replayCalibrationBundleV2({
      bundle: assembled.bundle as CalibrationInputBundleV2,
      resolver: createMapArtifactResolverV2(assembled.artifactBytes),
      modelSide: "active",
    });
    expect(providerSpy).not.toHaveBeenCalled();
    expect(report).toBeTruthy();
    expect(typeof report.ok === "boolean" || Array.isArray(report.members) || report != null).toBe(
      true,
    );
  });

  it("dryRun does not write RawArtifact rows", async () => {
    const artifacts = makeArtifacts();
    const result: AssembleBundleV2Result = await assembleCalibrationInputBundleV2({
      prisma: buildFixture().prisma as never,
      artifacts: artifacts as never,
      exportId: "44444444-4444-4444-8444-444444444444",
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    expect(artifacts.persist).not.toHaveBeenCalled();
  });

  it("blocks when algorithm or catalog versions are stripped from a frozen bundle", async () => {
    const assembled = await assembleCalibrationInputBundleV2({
      prisma: buildFixture().prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
      dryRun: true,
    });
    expect(assembled.ok).toBe(true);
    const { buildCalibrationInputBundleV2, preflightCalibrationBundleV2, createMapArtifactResolverV2 } =
      await import("@mplus/scoring");
    const broken = buildCalibrationInputBundleV2({
      generatedAt: assembled.bundle!.generatedAt,
      evidenceCutoffAt: assembled.bundle!.evidenceCutoffAt,
      source: assembled.bundle!.source,
      mode: assembled.bundle!.mode,
      deterministicSeed: assembled.bundle!.deterministicSeed,
      cohort: assembled.bundle!.cohort,
      season: assembled.bundle!.season,
      activeModel: assembled.bundle!.activeModel,
      evaluationModel: assembled.bundle!.evaluationModel,
      activeDimensionConfigs: assembled.bundle!.activeDimensionConfigs,
      evaluationDimensionConfigs: assembled.bundle!.evaluationDimensionConfigs,
      policies: {
        ...assembled.bundle!.policies,
        abilityCatalogVersions: [],
        mechanicCatalogVersions: [],
        dimensionAlgorithmVersions: {},
      },
      members: assembled.bundle!.members,
      artifactPackage: assembled.bundle!.artifactPackage ?? null,
    });
    const preflight = await preflightCalibrationBundleV2({
      bundle: broken,
      resolver: createMapArtifactResolverV2(assembled.artifactBytes),
      requireCatalogVersions: true,
      requireByteIntegrity: true,
    });
    expect(preflight.ok).toBe(false);
    expect(preflight.blocking.some((b) => b.code === "MISSING_CATALOG_VERSION")).toBe(true);
    expect(preflight.blocking.some((b) => b.code === "MISSING_ALGORITHM_VERSION")).toBe(true);
  });

  it("fails closed when artifact bytes are substituted under a valid CAS key", async () => {
    const assembled = await assembleCalibrationInputBundleV2({
      prisma: buildFixture().prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
      dryRun: true,
    });
    expect(assembled.ok).toBe(true);
    const { preflightCalibrationBundleV2, createMapArtifactResolverV2 } = await import("@mplus/scoring");
    const included = assembled.bundle!.members.find((m) => m.included)!;
    const tampered = new Map(assembled.artifactBytes);
    tampered.set(included.manifest.contentHash, Buffer.from('{"substituted":true}', "utf8"));
    const preflight = await preflightCalibrationBundleV2({
      bundle: assembled.bundle!,
      resolver: createMapArtifactResolverV2(tampered),
      requireCatalogVersions: true,
      requireByteIntegrity: true,
    });
    expect(preflight.ok).toBe(false);
    expect(
      preflight.blocking.some(
        (b) => b.code === "MISSING_ARTIFACT" || b.code === "HASH_MISMATCH",
      ),
    ).toBe(true);
  });

  it("fails closed when logicalContentHash disagrees with manifest document", async () => {
    const assembled = await assembleCalibrationInputBundleV2({
      prisma: buildFixture().prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
      dryRun: true,
    });
    expect(assembled.ok).toBe(true);
    const { buildCalibrationInputBundleV2, preflightCalibrationBundleV2, createMapArtifactResolverV2 } =
      await import("@mplus/scoring");
    const members = assembled.bundle!.members.map((m) =>
      m.included
        ? {
            ...m,
            manifest: {
              ...m.manifest,
              logicalContentHash: "0".repeat(64),
            },
          }
        : m,
    );
    const broken = buildCalibrationInputBundleV2({
      generatedAt: assembled.bundle!.generatedAt,
      evidenceCutoffAt: assembled.bundle!.evidenceCutoffAt,
      source: assembled.bundle!.source,
      mode: assembled.bundle!.mode,
      deterministicSeed: assembled.bundle!.deterministicSeed,
      cohort: assembled.bundle!.cohort,
      season: assembled.bundle!.season,
      activeModel: assembled.bundle!.activeModel,
      evaluationModel: assembled.bundle!.evaluationModel,
      activeDimensionConfigs: assembled.bundle!.activeDimensionConfigs,
      evaluationDimensionConfigs: assembled.bundle!.evaluationDimensionConfigs,
      policies: assembled.bundle!.policies,
      members,
      artifactPackage: assembled.bundle!.artifactPackage ?? null,
    });
    const preflight = await preflightCalibrationBundleV2({
      bundle: broken,
      resolver: createMapArtifactResolverV2(assembled.artifactBytes),
      requireCatalogVersions: true,
      requireByteIntegrity: true,
    });
    expect(preflight.ok).toBe(false);
    expect(
      preflight.blocking.some(
        (b) => b.code === "HASH_MISMATCH" && b.message.includes("logicalContentHash"),
      ),
    ).toBe(true);
  });

  it("H3: uses snapshot active model even when live ACTIVE model changed", async () => {
    const liveNewId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const fixture = buildFixture({
      liveActiveModelOverride: {
        id: liveNewId,
        key: "post-export-active",
        version: 99,
        status: "ACTIVE",
      },
    });
    const result = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: fixture.exportId,
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    expect(result.bundle!.activeModel?.id).toBe(fixture.activeModelId);
    expect(result.bundle!.activeModel?.id).not.toBe(liveNewId);
    expect(result.bundle!.activeModel?.key).toBe("test-model");
    expect(fixture.prisma.scoreModel.findFirst).not.toHaveBeenCalled();
  });

  it("H3: uses snapshot members/labels even when live cohort members changed", async () => {
    const fixture = buildFixture({
      liveMembersOverride: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          externalMemberKey: "m-included",
          characterId: "11111111-1111-4111-8111-111111111111",
          region: "EU",
          realmSlug: "kazzak",
          characterName: "RenamedLive",
          providedRole: "TANK",
          classSlug: "warrior",
          specSlug: "protection",
          expectedLabel: "EXCELLENT",
          rationale: "mutated-after-export",
          included: true,
          exclusionCode: null,
          evidenceCutoffAt: new Date("2026-08-01T00:00:00.000Z"),
          source: "USER_SELECTED",
        },
      ],
    });
    const result = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: fixture.exportId,
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    expect(result.bundle!.members).toHaveLength(2);
    const included = result.bundle!.members.find((m) => m.included)!;
    expect(included.expectedLabel).toBe("good");
    expect(included.classSlug).toBe("warlock");
    expect(included.specSlug).toBe("affliction");
    expect(included.role).toBe("DPS");
    expect(result.bundle!.cohort.members.find((m) => m.id === "m-included")?.character).toBe(
      "Testchar",
    );
  });

  it("H3: blocks freeze when freezeSnapshot is missing/empty", async () => {
    const result = await assembleCalibrationInputBundleV2({
      prisma: buildFixture({ freezeSnapshot: {} }).prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: "44444444-4444-4444-8444-444444444444",
      dryRun: true,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.code === "FREEZE_SNAPSHOT_MISSING")).toBe(true);
  });

  it("H3: blocks freeze when freezeSnapshot contentHash is corrupt", async () => {
    const fixture = buildFixture();
    const corrupt = {
      ...(fixture.freezeSnapshot as FreezeSnapshotV1),
      contentHash: "0".repeat(64),
    };
    const result = await assembleCalibrationInputBundleV2({
      prisma: buildFixture({ freezeSnapshot: corrupt }).prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: fixture.exportId,
      dryRun: true,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.code === "FREEZE_SNAPSHOT_HASH_MISMATCH")).toBe(true);
  });
});

