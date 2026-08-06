/**
 * Unit tests for Calibration Input Bundle V2 freeze assembly.
 * Provider-free. Uses in-memory prisma/artifact fakes — no live providers.
 * H3: freeze consumes export-time freezeSnapshot, not live ACTIVE/cohort.
 * H7: freeze assembles only from freezeSnapshot evidence refs + verified CAS bytes.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ArtifactDigestMismatchError,
  ArtifactMissingError,
} from "@mplus/database";
import {
  createMapArtifactResolverV2,
  createDefaultModelV6,
  createDefaultscoringDimensionConfigSet,
  buildCalibrationContentRefV2,
  buildDefaultFreezePolicies,
  buildFreezeSnapshot,
  resolveFrozenDimensionConfigsForModel,
  replayCalibrationBundleV2,
  withscoringDimensionConfigs,
  type CalibrationInputBundleV2,
  type FreezeSnapshotContentRefV2,
  type FreezeSnapshotMemberEvidenceV2,
  type FreezeSnapshotV1,
} from "@mplus/scoring";
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import {
  assembleCalibrationInputBundleV2,
  type AssembleBundleV2Result,
} from "./scoring-bundle-freeze.js";

function sha256Hex(bytes: Buffer | string): string {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  return createHash("sha256").update(buf).digest("hex");
}

function sha256Json(value: unknown): string {
  return sha256Hex(JSON.stringify(value));
}

function makeModelConfig() {
  return withscoringDimensionConfigs(
    createDefaultModelV6({ key: "test-model", version: 6 }),
    createDefaultscoringDimensionConfigSet(),
  );
}

function toFreezeRef(
  bytes: Buffer,
  artifactClass: FreezeSnapshotContentRefV2["artifactClass"],
  opts?: { logicalContentHash?: string | null; schemaVersion?: string | null },
): FreezeSnapshotContentRefV2 {
  const ref = buildCalibrationContentRefV2({
    bytes,
    artifactClass,
    logicalContentHash: opts?.logicalContentHash ?? null,
    schemaVersion: opts?.schemaVersion ?? null,
    storageUri: `memory://${sha256Hex(bytes)}`,
  });
  return {
    contentHash: ref.contentHash,
    logicalContentHash: ref.logicalContentHash ?? null,
    byteDigest: ref.byteDigest!,
    digestAlgorithm: "sha256",
    artifactClass: ref.artifactClass,
    schemaVersion: ref.schemaVersion ?? null,
    byteLength: ref.byteLength ?? bytes.byteLength,
    storageUri: ref.storageUri ?? null,
  };
}

function makeArtifacts(seed?: Map<string, Buffer>) {
  const store = seed ? new Map(seed) : new Map<string, Buffer>();
  return {
    store,
    persist: vi.fn(async (input: { bytes: Buffer | Uint8Array }) => {
      const bytes = Buffer.from(input.bytes);
      const contentHash = sha256Hex(bytes);
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
    readVerifiedByContentHash: vi.fn(async (contentHash: string) => {
      const hash = contentHash.toLowerCase();
      const bytes = store.get(hash);
      if (!bytes) throw new ArtifactMissingError(hash);
      const actual = sha256Hex(bytes);
      if (actual !== hash) throw new ArtifactDigestMismatchError(hash, actual);
      return bytes;
    }),
  };
}

type FixtureOpts = {
  includeExcluded?: boolean;
  omitManifest?: boolean;
  omitFactSets?: boolean;
  omitDimension?: boolean;
  evaluationModelId?: string | null;
  /** Put evaluation model into freezeSnapshot (required for active-vs-draft). */
  pinEvaluationModel?: boolean;
  mutateFactPayload?: (facts: unknown) => unknown;
  /** Override freezeSnapshot on the export row (undefined = auto-build valid snapshot). */
  freezeSnapshot?: unknown;
  /** Mutate live ACTIVE model returned by findFirst (should be ignored by freeze). */
  liveActiveModelOverride?: Record<string, unknown>;
  /** Mutate live cohort members if somehow queried (should be unused). */
  liveMembersOverride?: unknown[];
  /** Drop CAS bytes after packaging (adversarial). */
  dropCasArtifact?: "manifest" | "fact" | "dimension";
  /** Alter CAS bytes under a valid key after packaging (adversarial). */
  tamperCasManifest?: boolean;
  /** Delete/mutate live evidence tables after packaging (should not affect freeze). */
  wipeLiveEvidence?: boolean;
};

function packageEvidence(input: {
  cas: Map<string, Buffer>;
  manifestDocument: unknown;
  manifestContentHash: string;
  factPayload: unknown | null;
  dims: Array<Record<string, unknown>>;
  previousSnapshotId: string | null;
}): FreezeSnapshotMemberEvidenceV2 | null {
  if (input.manifestDocument == null) return null;

  const manifestBytes = Buffer.from(JSON.stringify(input.manifestDocument), "utf8");
  input.cas.set(sha256Hex(manifestBytes), manifestBytes);
  const manifest = toFreezeRef(manifestBytes, "evidence_manifest", {
    logicalContentHash: input.manifestContentHash,
    schemaVersion: "2.0.0",
  });

  const factSets: FreezeSnapshotContentRefV2[] = [];
  if (input.factPayload) {
    const factBytes = Buffer.from(JSON.stringify(input.factPayload), "utf8");
    input.cas.set(sha256Hex(factBytes), factBytes);
    factSets.push(
      toFreezeRef(factBytes, "run_fact_set", { schemaVersion: "utility-v2-facts" }),
    );
  }

  const dimensionExports: FreezeSnapshotMemberEvidenceV2["dimensionExports"] = {};
  for (const dim of input.dims) {
    const exportDoc = {
      schemaVersion: "2.0.0",
      dimension: dim.dimension,
      algorithmVersion: dim.algorithmVersion,
      inputFingerprint: dim.inputFingerprint,
      score: dim.score,
      confidence: dim.confidence,
      state: dim.state,
      metrics: dim.metrics,
      explanation: dim.explanation,
      computedAt:
        dim.computedAt instanceof Date
          ? dim.computedAt.toISOString()
          : String(dim.computedAt),
    };
    const dimBytes = Buffer.from(JSON.stringify(exportDoc), "utf8");
    input.cas.set(sha256Hex(dimBytes), dimBytes);
    dimensionExports[dim.dimension as keyof typeof dimensionExports] = toFreezeRef(
      dimBytes,
      "dimension_replay_export",
      { schemaVersion: "2.0.0" },
    );
  }

  let previousSnapshot: FreezeSnapshotContentRefV2 | null = null;
  if (input.previousSnapshotId) {
    const payload = {
      schemaVersion: "score-snapshot-export-v1",
      id: input.previousSnapshotId,
      characterId: "11111111-1111-4111-8111-111111111111",
      seasonId: "22222222-2222-4222-8222-222222222222",
      overallScore: 70,
      grade: "B",
    };
    const snapBytes = Buffer.from(JSON.stringify(payload), "utf8");
    input.cas.set(sha256Hex(snapBytes), snapBytes);
    previousSnapshot = toFreezeRef(snapBytes, "other", {
      schemaVersion: "score-snapshot-export-v1",
    });
  }

  return { manifest, factSets, dimensionExports, previousSnapshot };
}

function buildFreezeSnapshotForFixture(input: {
  cohortId: string;
  seasonId: string;
  completedAt: Date;
  evidenceCutoffAt: Date;
  members: Array<Record<string, unknown>>;
  memberEvidence: Map<string, FreezeSnapshotMemberEvidenceV2 | null>;
  activeModel: {
    id: string;
    key: string;
    version: number;
    status: string;
    config: ReturnType<typeof makeModelConfig>;
  };
  evaluationModel?: {
    id: string;
    key: string;
    version: number;
    status: string;
    config: ReturnType<typeof makeModelConfig>;
  } | null;
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
  const evaluationModel = input.evaluationModel
    ? (() => {
        const evalRef = {
          id: input.evaluationModel.id,
          key: input.evaluationModel.key,
          version: input.evaluationModel.version,
          status: input.evaluationModel.status as "DRAFT",
          config: input.evaluationModel.config,
          isActive: false as const,
        };
        return {
          ...evalRef,
          dimensionConfigs: resolveFrozenDimensionConfigsForModel(evalRef, "calibration-strict"),
        };
      })()
    : null;
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
      evidence: input.memberEvidence.get(String(m.id)) ?? null,
    })),
    season: {
      seasonId: input.seasonId,
      seasonSlug: "season-tww-1",
      region: "eu",
    },
    activeModel: { ...modelRef, dimensionConfigs },
    evaluationModel,
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
    facts: opts.mutateFactPayload
      ? opts.mutateFactPayload({ kind: "fixture-fact" })
      : { kind: "fixture-fact" },
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

  const cas = new Map<string, Buffer>();
  const memberEvidence = new Map<string, FreezeSnapshotMemberEvidenceV2 | null>();
  if (!opts.omitManifest) {
    const packaged = packageEvidence({
      cas,
      manifestDocument,
      manifestContentHash,
      factPayload: opts.omitFactSets ? null : factPayload,
      dims,
      previousSnapshotId: "snap-1",
    });
    // Incomplete packages (omit fact/dim) still embed what we have so freeze can surface blockers.
    if (packaged && (opts.omitFactSets || opts.omitDimension)) {
      memberEvidence.set(memberInclId, packaged);
    } else if (packaged && packaged.factSets.length > 0 && dims.length === 4) {
      memberEvidence.set(memberInclId, packaged);
    } else if (packaged) {
      memberEvidence.set(memberInclId, packaged);
    }
  } else {
    // Included member without evidence — invalid for v2 parse; use override path via freezeSnapshot.
  }
  memberEvidence.set(memberExclId, null);

  if (opts.dropCasArtifact === "manifest") {
    const ev = memberEvidence.get(memberInclId);
    if (ev) cas.delete(ev.manifest.contentHash);
  }
  if (opts.dropCasArtifact === "fact") {
    const ev = memberEvidence.get(memberInclId);
    if (ev?.factSets[0]) cas.delete(ev.factSets[0].contentHash);
  }
  if (opts.dropCasArtifact === "dimension") {
    const ev = memberEvidence.get(memberInclId);
    const dimHash = ev?.dimensionExports.PERFORMANCE?.contentHash;
    if (dimHash) cas.delete(dimHash);
  }
  if (opts.tamperCasManifest) {
    const ev = memberEvidence.get(memberInclId);
    if (ev) {
      // Keep key, alter bytes → digest mismatch on readVerifiedByContentHash.
      cas.set(ev.manifest.contentHash, Buffer.from('{"tampered":true}', "utf8"));
    }
  }

  const freezeSnapshot =
    opts.freezeSnapshot !== undefined
      ? opts.freezeSnapshot
      : buildFreezeSnapshotForFixture({
          cohortId,
          seasonId,
          completedAt,
          evidenceCutoffAt,
          members,
          memberEvidence,
          activeModel,
          evaluationModel:
            opts.pinEvaluationModel || opts.evaluationModelId
              ? draftModel
              : null,
        });

  const liveMembers = opts.liveMembersOverride ?? members;
  const liveManifest = opts.wipeLiveEvidence
    ? null
    : {
        id: manifestId,
        contentHash: "deadbeef".repeat(8),
        schemaVersion: "2.0.0",
        document: { mutated: true },
        frozenAt: evidenceCutoffAt,
        slots: [{ id: slotId, factSets: [{ facts: { live: "mutated" } }] }],
      };

  const prisma = {
    scoringEvidenceExport: {
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
          members: liveMembers,
        },
      })),
    },
    season: {
      findUnique: vi.fn(async () => ({
        id: seasonId,
        slug: "season-tww-1-LIVE-CHANGED",
        name: "TWW 1",
        regionId: "reg-1",
        region: { code: "us" },
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
      findFirst: vi.fn(async () => liveManifest),
    },
    dimensionComputation: {
      findMany: vi.fn(async () =>
        opts.wipeLiveEvidence
          ? []
          : [{ dimension: "PERFORMANCE", score: 1, computedAt: evidenceCutoffAt }],
      ),
    },
    scoreSnapshot: {
      findFirst: vi.fn(async () =>
        opts.wipeLiveEvidence ? null : { id: "live-snap-mutated" },
      ),
    },
    character: {
      findUnique: vi.fn(async () => ({
        id: charId,
        classSlug: "warrior",
        specSlug: "protection",
      })),
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
    cas,
    memberEvidence,
  };
}

describe("assembleCalibrationInputBundleV2", () => {
  it("freezes the complete member graph including excluded members", async () => {
    const fixture = buildFixture();
    const artifacts = makeArtifacts(fixture.cas);
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
    expect(sha256Hex(storedManifest!)).toBe(included.manifest.contentHash);
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
    // H3/H7: must not query live ACTIVE model / evidence / snapshot for freeze inputs.
    expect(fixture.prisma.scoreModel.findFirst).not.toHaveBeenCalled();
    expect(fixture.prisma.evidenceManifest.findFirst).not.toHaveBeenCalled();
    expect(fixture.prisma.dimensionComputation.findMany).not.toHaveBeenCalled();
    expect(fixture.prisma.scoreSnapshot.findFirst).not.toHaveBeenCalled();
    expect(fixture.prisma.scoreModel.findUnique).not.toHaveBeenCalled();
  });

  it("produces the same root hash for identical inputs", async () => {
    const aFix = buildFixture();
    const bFix = buildFixture();
    const a = await assembleCalibrationInputBundleV2({
      prisma: aFix.prisma as never,
      artifacts: makeArtifacts(aFix.cas) as never,
      exportId: aFix.exportId,
    });
    const b = await assembleCalibrationInputBundleV2({
      prisma: bFix.prisma as never,
      artifacts: makeArtifacts(bFix.cas) as never,
      exportId: bFix.exportId,
    });
    expect(a.ok && b.ok).toBe(true);
    expect(a.bundle!.bundleHash).toBe(b.bundle!.bundleHash);
  });

  it("changes root hash when a fact-set payload changes", async () => {
    const baseFix = buildFixture();
    const changedFix = buildFixture({
      mutateFactPayload: () => ({ kind: "fixture-fact-changed" }),
    });
    const base = await assembleCalibrationInputBundleV2({
      prisma: baseFix.prisma as never,
      artifacts: makeArtifacts(baseFix.cas) as never,
      exportId: baseFix.exportId,
    });
    const changed = await assembleCalibrationInputBundleV2({
      prisma: changedFix.prisma as never,
      artifacts: makeArtifacts(changedFix.cas) as never,
      exportId: changedFix.exportId,
    });
    expect(base.ok && changed.ok).toBe(true);
    expect(changed.bundle!.bundleHash).not.toBe(base.bundle!.bundleHash);
  });

  it("blocks freeze when packaged evidence is missing for included member", async () => {
    const base = buildFixture();
    const snap = base.freezeSnapshot as FreezeSnapshotV1;
    const rebuilt = buildFreezeSnapshot({
      cohortId: snap.cohortId,
      cohortExternalKey: snap.cohortExternalKey,
      cohortName: snap.cohortName,
      cohortDescription: snap.cohortDescription,
      cohortCreatedAt: snap.cohortCreatedAt,
      cohortRevision: snap.cohortRevision,
      season: snap.season,
      activeModel: snap.activeModel,
      evaluationModel: snap.evaluationModel,
      policies: snap.policies,
      evidenceCutoffAt: snap.evidenceCutoffAt,
      generatedAt: snap.generatedAt,
      members: snap.members.map((m) =>
        m.included ? { ...m, evidence: null } : m,
      ),
    });
    const result = await assembleCalibrationInputBundleV2({
      prisma: buildFixture({ freezeSnapshot: rebuilt }).prisma as never,
      artifacts: makeArtifacts() as never,
      exportId: base.exportId,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.code === "FREEZE_SNAPSHOT_INVALID")).toBe(true);
  });

  it("blocks freeze when fact sets are missing in packaged evidence", async () => {
    const result = await assembleCalibrationInputBundleV2({
      prisma: buildFixture({ omitFactSets: true }).prisma as never,
      artifacts: makeArtifacts(buildFixture({ omitFactSets: true }).cas) as never,
      exportId: "44444444-4444-4444-8444-444444444444",
    });
    expect(result.ok).toBe(false);
    expect(
      result.blockers.some(
        (b) => b.code === "FREEZE_SNAPSHOT_INVALID" || b.code === "FACT_SET_MISSING",
      ),
    ).toBe(true);
  });

  it("blocks freeze when a dimension export is missing in packaged evidence", async () => {
    const fixture = buildFixture({ omitDimension: true });
    const result = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts(fixture.cas) as never,
      exportId: fixture.exportId,
    });
    expect(result.ok).toBe(false);
    expect(
      result.blockers.some(
        (b) =>
          b.code === "FREEZE_SNAPSHOT_INVALID" || b.code === "DIMENSION_EXPORT_MISSING",
      ),
    ).toBe(true);
  });

  it("freezes ACTIVE and DRAFT configs from snapshot when evaluation model is pinned", async () => {
    const fixture = buildFixture({
      evaluationModelId: "99999999-9999-4999-8999-999999999999",
      pinEvaluationModel: true,
    });
    const result = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts(fixture.cas) as never,
      exportId: fixture.exportId,
      evaluationModelId: fixture.draftModelId,
    });
    expect(result.ok).toBe(true);
    expect(result.bundle!.activeModel?.id).toBe(fixture.activeModelId);
    expect(result.bundle!.evaluationModel?.id).toBe(fixture.draftModelId);
    expect(result.bundle!.activeDimensionConfigs).toBeTruthy();
    expect(result.bundle!.evaluationDimensionConfigs).toBeTruthy();
    expect(fixture.prisma.scoreModel.findUnique).not.toHaveBeenCalled();
    expect(fixture.activeModel.status).toBe("ACTIVE");
    expect(fixture.draftModel.status).toBe("DRAFT");
  });

  it("rejects evaluationModelId not present in freezeSnapshot", async () => {
    const fixture = buildFixture();
    const result = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts(fixture.cas) as never,
      exportId: fixture.exportId,
      evaluationModelId: fixture.draftModelId,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.code === "EVALUATION_MODEL_NOT_IN_SNAPSHOT")).toBe(
      true,
    );
  });

  it("is consumable by Calibration V2 replay with zero provider calls", async () => {
    const fixture = buildFixture();
    const assembled = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts(fixture.cas) as never,
      exportId: fixture.exportId,
    });
    expect(assembled.ok).toBe(true);
    expect(assembled.bundle).toBeTruthy();

    const report = await replayCalibrationBundleV2({
      bundle: assembled.bundle as CalibrationInputBundleV2,
      resolver: createMapArtifactResolverV2(assembled.artifactBytes),
      modelSide: "active",
    });

    expect(report.schemaVersion).toBe("calibration-replay-v2");
    expect(report.providerCalls).toBe(0);
    expect(report.refreshCalls).toBe(0);
    expect(report.modelActivated).toBe(false);
    expect(report.publicationMutated).toBe(false);
    expect(report.bundleHash).toBe(assembled.bundle!.bundleHash);
    expect(report.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.members).toHaveLength(1);
    expect(report.members[0]!.memberId).toBe("55555555-5555-4555-8555-555555555555");
    expect(report.members[0]!.expectedLabel).toBe("good");
    expect(Array.isArray(report.members[0]!.dimensions)).toBe(true);
    expect(Array.isArray(report.members[0]!.errors)).toBe(true);
    expect(report.preflightIssues.filter((i) => i.severity === "BLOCKING")).toHaveLength(0);

    const again = await replayCalibrationBundleV2({
      bundle: assembled.bundle as CalibrationInputBundleV2,
      resolver: createMapArtifactResolverV2(assembled.artifactBytes),
      modelSide: "active",
    });
    expect(again.contentHash).toBe(report.contentHash);
    expect(again.providerCalls).toBe(0);
  });

  it("dryRun does not write RawArtifact rows but still reads CAS", async () => {
    const fixture = buildFixture();
    const artifacts = makeArtifacts(fixture.cas);
    const result: AssembleBundleV2Result = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: artifacts as never,
      exportId: fixture.exportId,
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    expect(artifacts.persist).not.toHaveBeenCalled();
    expect(artifacts.readVerifiedByContentHash).toHaveBeenCalled();
  });

  it("blocks when algorithm or catalog versions are stripped from a frozen bundle", async () => {
    const fixture = buildFixture();
    const assembled = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts(fixture.cas) as never,
      exportId: fixture.exportId,
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
    const fixture = buildFixture();
    const assembled = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts(fixture.cas) as never,
      exportId: fixture.exportId,
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
    const fixture = buildFixture();
    const assembled = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts(fixture.cas) as never,
      exportId: fixture.exportId,
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
      artifacts: makeArtifacts(fixture.cas) as never,
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
      artifacts: makeArtifacts(fixture.cas) as never,
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
      artifacts: makeArtifacts(fixture.cas) as never,
      exportId: fixture.exportId,
      dryRun: true,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.code === "FREEZE_SNAPSHOT_HASH_MISMATCH")).toBe(true);
  });

  it("H7 adversarial: freeze succeeds after live evidence/character mutation using export digests", async () => {
    const fixture = buildFixture({ wipeLiveEvidence: true });
    const exportDigests = {
      manifest: fixture.memberEvidence.get(fixture.memberInclId)!.manifest.contentHash,
      fact: fixture.memberEvidence.get(fixture.memberInclId)!.factSets[0]!.contentHash,
      performance:
        fixture.memberEvidence.get(fixture.memberInclId)!.dimensionExports.PERFORMANCE!
          .contentHash,
    };
    const result = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts(fixture.cas) as never,
      exportId: fixture.exportId,
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    const included = result.bundle!.members.find((m) => m.included)!;
    expect(included.manifest.contentHash).toBe(exportDigests.manifest);
    expect(included.factSets[0]!.contentHash).toBe(exportDigests.fact);
    expect(included.dimensionExports.PERFORMANCE!.contentHash).toBe(exportDigests.performance);
    expect(included.previousSnapshotId).toBe("snap-1");
    expect(included.classSlug).toBe("warlock");
    expect(fixture.prisma.evidenceManifest.findFirst).not.toHaveBeenCalled();
    expect(fixture.prisma.character.findUnique).not.toHaveBeenCalled();
    expect(fixture.prisma.season.findUnique).not.toHaveBeenCalled();
  });

  it("H7 adversarial: missing CAS artifact blocks freeze", async () => {
    const fixture = buildFixture({ dropCasArtifact: "manifest" });
    const result = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts(fixture.cas) as never,
      exportId: fixture.exportId,
      dryRun: true,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.code === "ARTIFACT_MISSING")).toBe(true);
  });

  it("H7 adversarial: altered CAS bytes block freeze with digest mismatch", async () => {
    const fixture = buildFixture({ tamperCasManifest: true });
    const result = await assembleCalibrationInputBundleV2({
      prisma: fixture.prisma as never,
      artifacts: makeArtifacts(fixture.cas) as never,
      exportId: fixture.exportId,
      dryRun: true,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.code === "ARTIFACT_DIGEST_MISMATCH")).toBe(true);
  });
});
