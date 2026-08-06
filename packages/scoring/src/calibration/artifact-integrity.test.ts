/**
 * Adversarial byte-integrity tests for Calibration Bundle V2 (BLOCKER B2).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCalibrationContentRefV2,
  buildCalibrationInputBundleV2,
  computeArtifactSha256Hex,
  createMapArtifactResolverV2,
  formatArtifactByteDigest,
  preflightCalibrationBundleV2,
  type CalibrationContentRefV2,
  type CalibrationInputBundleV2,
} from "./index.js";
import { COHORT_MANIFEST_SCHEMA_VERSION } from "./types.js";
import { createDefaultscoringDimensionConfigSet, withscoringDimensionConfigs } from "../model-config/index.js";
import { createDefaultModelV6 } from "../model/defaults.js";

function sha256Hex(bytes: string | Buffer | Uint8Array): string {
  return computeArtifactSha256Hex(bytes);
}

function pack(payload: unknown): { bytes: Buffer; ref: CalibrationContentRefV2 } {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    bytes,
    ref: buildCalibrationContentRefV2({
      bytes,
      artifactClass: "other",
      schemaVersion: "2.0.0",
    }),
  };
}

function baseBundle(
  members: CalibrationInputBundleV2["members"],
): CalibrationInputBundleV2 {
  const scoring = createDefaultscoringDimensionConfigSet();
  const modelConfig = withscoringDimensionConfigs(createDefaultModelV6(), scoring);
  const model = {
    key: modelConfig.key,
    version: modelConfig.version,
    status: "DRAFT" as const,
    config: modelConfig,
    isActive: false,
  };
  return buildCalibrationInputBundleV2({
    generatedAt: "2026-08-01T12:00:00.000Z",
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    source: "fixture",
    mode: "persisted-snapshot-only",
    deterministicSeed: 1,
    cohort: {
      schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
      cohortId: "c",
      description: "d",
      createdAt: "2026-08-01T12:00:00.000Z",
      members: [
        {
          id: "m1",
          region: "eu",
          realm: "r",
          character: "x",
          role: "DPS",
          classSlug: "mage",
          specSlug: "frost",
          expectedLabel: "good",
          meta: false,
          rationale: "r",
          suspectedBoost: false,
          source: "user-selected",
        },
      ],
    },
    season: { seasonId: "s", seasonSlug: "season", region: "eu" },
    activeModel: { ...model, status: "ACTIVE", isActive: true },
    evaluationModel: null,
    policies: {
      difficultyPolicies: [{ id: "p", version: "1" }],
      abilityCatalogVersions: ["a"],
      mechanicCatalogVersions: ["m"],
      confidenceAlgorithmVersions: { overall: "c" },
      dimensionAlgorithmVersions: {
        PERFORMANCE: "p",
        SURVIVAL: "s",
        UTILITY: "u",
        EXPERIENCE: "e",
      },
    },
    members,
    artifactPackage: null,
  });
}

describe("artifact byte integrity (B2)", () => {
  it("resolver returns computed digest, not the request key echo", async () => {
    const bytes = Buffer.from('{"ok":true}', "utf8");
    const hex = sha256Hex(bytes);
    const resolver = createMapArtifactResolverV2(new Map([[hex, bytes]]));
    const resolved = await resolver.resolve(hex);
    expect(resolved).not.toBeNull();
    expect(resolved!.contentHash).toBe(hex);
    expect(sha256Hex(resolved!.bytes)).toBe(hex);
  });

  it("resolver refuses wrong-key alias (cannot lie by echoing request)", async () => {
    const bytes = Buffer.from("real-payload", "utf8");
    const realHex = sha256Hex(bytes);
    const fakeKey = "a".repeat(64);
    // Attacker stores bytes under a key that is not their digest.
    const resolver = createMapArtifactResolverV2(new Map([[fakeKey, bytes]]));
    expect(await resolver.resolve(fakeKey)).toBeNull();
    // Correct CAS key still works when stored correctly.
    const ok = createMapArtifactResolverV2(new Map([[realHex, bytes]]));
    expect((await ok.resolve(realHex))?.contentHash).toBe(realHex);
  });

  it("valid ID with substituted bytes fails preflight", async () => {
    const honest = pack({ kind: "honest" });
    const substituted = Buffer.from(JSON.stringify({ kind: "evil" }), "utf8");
    const member = {
      memberId: "m1",
      characterId: "c1",
      expectedLabel: "good" as const,
      rationale: "r",
      role: "DPS" as const,
      classSlug: "mage",
      specSlug: "frost",
      included: true,
      exclusionCode: null,
      evidenceCutoffAt: null,
      manifest: {
        ...honest.ref,
        artifactClass: "evidence_manifest" as const,
        logicalContentHash: null,
      },
      factSets: [],
      dimensionExports: {},
    };
    const bundle = baseBundle([member]);
    // Keep valid CAS key but substitute different bytes under it.
    const artifacts = new Map<string, Uint8Array>([[honest.ref.contentHash, substituted]]);
    const preflight = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(artifacts),
      requireCatalogVersions: false,
      requireByteIntegrity: true,
    });
    expect(preflight.ok).toBe(false);
    expect(
      preflight.blocking.some(
        (b) => b.code === "MISSING_ARTIFACT" || b.code === "HASH_MISMATCH",
      ),
    ).toBe(true);
  });

  it("logical hash correct but byte digest wrong fails", async () => {
    const logical = "b".repeat(64);
    const bytes = Buffer.from(
      JSON.stringify({ schemaVersion: "2.0.0", contentHash: logical, slots: [] }),
      "utf8",
    );
    const realHex = sha256Hex(bytes);
    const wrongDigestHex = "c".repeat(64);
    const ref: CalibrationContentRefV2 = {
      contentHash: wrongDigestHex,
      logicalContentHash: logical,
      byteDigest: formatArtifactByteDigest(wrongDigestHex),
      digestAlgorithm: "sha256",
      artifactClass: "evidence_manifest",
      schemaVersion: "2.0.0",
      byteLength: bytes.byteLength,
    };
    const bundle = baseBundle([
      {
        memberId: "m1",
        characterId: "c1",
        expectedLabel: "good",
        rationale: "r",
        role: "DPS",
        classSlug: "mage",
        specSlug: "frost",
        included: true,
        exclusionCode: null,
        evidenceCutoffAt: null,
        manifest: ref,
        factSets: [],
        dimensionExports: {},
      },
    ]);
    // Store under wrong CAS key declared in ref — resolver refuses alias.
    const artifacts = new Map<string, Uint8Array>([
      [wrongDigestHex, bytes],
      [realHex, bytes],
    ]);
    const preflight = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(artifacts),
      requireCatalogVersions: false,
      requireByteIntegrity: true,
    });
    expect(preflight.ok).toBe(false);
    expect(preflight.blocking.some((b) => b.code === "MISSING_ARTIFACT" || b.code === "HASH_MISMATCH")).toBe(
      true,
    );
  });

  it("byte digest correct but logical hash wrong fails for manifests", async () => {
    const logicalCorrect = "d".repeat(64);
    const logicalWrong = "e".repeat(64);
    const bytes = Buffer.from(
      JSON.stringify({ schemaVersion: "2.0.0", contentHash: logicalCorrect, slots: [] }),
      "utf8",
    );
    const ref = buildCalibrationContentRefV2({
      bytes,
      artifactClass: "evidence_manifest",
      logicalContentHash: logicalWrong,
      schemaVersion: "2.0.0",
    });
    const bundle = baseBundle([
      {
        memberId: "m1",
        characterId: "c1",
        expectedLabel: "good",
        rationale: "r",
        role: "DPS",
        classSlug: "mage",
        specSlug: "frost",
        included: true,
        exclusionCode: null,
        evidenceCutoffAt: null,
        manifest: ref,
        factSets: [],
        dimensionExports: {},
      },
    ]);
    const artifacts = new Map<string, Uint8Array>([[ref.contentHash, bytes]]);
    const preflight = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(artifacts),
      requireCatalogVersions: false,
      requireByteIntegrity: true,
    });
    expect(preflight.ok).toBe(false);
    expect(preflight.blocking.some((b) => b.code === "HASH_MISMATCH" && b.message.includes("logicalContentHash"))).toBe(
      true,
    );
  });

  it("truncated bytes fail via digest / byteLength", async () => {
    const full = Buffer.from(JSON.stringify({ kind: "full-payload", n: 1 }), "utf8");
    const ref = buildCalibrationContentRefV2({
      bytes: full,
      artifactClass: "run_fact_set",
    });
    const truncated = full.subarray(0, Math.max(1, full.byteLength - 4));
    const bundle = baseBundle([
      {
        memberId: "m1",
        characterId: "c1",
        expectedLabel: "good",
        rationale: "r",
        role: "DPS",
        classSlug: "mage",
        specSlug: "frost",
        included: true,
        exclusionCode: null,
        evidenceCutoffAt: null,
        manifest: buildCalibrationContentRefV2({
          bytes: Buffer.from(JSON.stringify({ schemaVersion: "2.0.0", contentHash: "f".repeat(64), slots: [] })),
          artifactClass: "evidence_manifest",
          logicalContentHash: "f".repeat(64),
        }),
        factSets: [ref],
        dimensionExports: {},
      },
    ]);
    const manifestRef = bundle.members[0]!.manifest;
    const manifestBytes = Buffer.from(
      JSON.stringify({ schemaVersion: "2.0.0", contentHash: "f".repeat(64), slots: [] }),
    );
    // Put truncated bytes under the original CAS key — resolver refuses (digest≠key).
    const artifacts = new Map<string, Uint8Array>([
      [manifestRef.contentHash, manifestBytes],
      [ref.contentHash, truncated],
    ]);
    const preflight = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(artifacts),
      requireCatalogVersions: false,
      requireByteIntegrity: true,
    });
    expect(preflight.ok).toBe(false);
    expect(
      preflight.blocking.some(
        (b) => b.code === "MISSING_ARTIFACT" || b.code === "HASH_MISMATCH",
      ),
    ).toBe(true);
  });

  it("unsupported digest algorithm fails closed at validate and preflight", async () => {
    const bytes = Buffer.from("{}", "utf8");
    const hex = sha256Hex(bytes);
    const raw = {
      contentHash: hex,
      byteDigest: `md5:${hex}`,
      digestAlgorithm: "md5",
      artifactClass: "other",
    };
    const { validateCalibrationInputBundleV2 } = await import("./bundle-v2.js");
    const scored = createDefaultModelV6();
    const validated = validateCalibrationInputBundleV2({
      schemaVersion: "2.0.0",
      generatedAt: "2026-08-01T12:00:00.000Z",
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      source: "fixture",
      deterministicSeed: 1,
      cohort: {
        schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
        cohortId: "c",
        description: "d",
        createdAt: "2026-08-01T12:00:00.000Z",
        members: [],
      },
      season: { seasonId: "s", seasonSlug: "s", region: "eu" },
      activeModel: {
        key: scored.key,
        version: scored.version,
        status: "ACTIVE",
        config: scored,
        isActive: true,
      },
      evaluationModel: null,
      policies: {
        difficultyPolicies: [],
        abilityCatalogVersions: ["a"],
        mechanicCatalogVersions: ["m"],
        confidenceAlgorithmVersions: {},
        dimensionAlgorithmVersions: {
          PERFORMANCE: "p",
          SURVIVAL: "s",
          UTILITY: "u",
          EXPERIENCE: "e",
        },
      },
      members: [
        {
          memberId: "m1",
          characterId: "c1",
          expectedLabel: "good",
          rationale: "r",
          role: "DPS",
          classSlug: "mage",
          specSlug: "frost",
          included: true,
          exclusionCode: null,
          evidenceCutoffAt: null,
          manifest: raw,
          factSets: [],
          dimensionExports: {},
        },
      ],
      artifactPackage: null,
    });
    expect(validated.ok).toBe(false);
    expect(validated.errors.some((e) => e.code === "HASH_MISMATCH")).toBe(true);

    // Preflight path: inject unsupported algorithm on a structurally valid bundle.
    const honest = pack({ x: 1 });
    const bundle = baseBundle([
      {
        memberId: "m1",
        characterId: "c1",
        expectedLabel: "good",
        rationale: "r",
        role: "DPS",
        classSlug: "mage",
        specSlug: "frost",
        included: true,
        exclusionCode: null,
        evidenceCutoffAt: null,
        manifest: {
          ...honest.ref,
          artifactClass: "evidence_manifest",
        },
        factSets: [],
        dimensionExports: {},
      },
    ]);
    (bundle.members[0]!.manifest as { digestAlgorithm: string }).digestAlgorithm = "sha512";
    (bundle.members[0]!.manifest as { byteDigest: string }).byteDigest =
      `sha512:${honest.ref.contentHash}`;
    const preflight = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(new Map([[honest.ref.contentHash, honest.bytes]])),
      requireCatalogVersions: false,
      requireByteIntegrity: true,
    });
    expect(preflight.ok).toBe(false);
    expect(preflight.blocking.some((b) => b.message.includes("unsupported") || b.code === "HASH_MISMATCH")).toBe(
      true,
    );
  });

  it("requireByteIntegrity fails closed when byteDigest is missing", async () => {
    const bytes = Buffer.from("{}", "utf8");
    const hex = sha256Hex(bytes);
    const bundle = baseBundle([
      {
        memberId: "m1",
        characterId: "c1",
        expectedLabel: "good",
        rationale: "r",
        role: "DPS",
        classSlug: "mage",
        specSlug: "frost",
        included: true,
        exclusionCode: null,
        evidenceCutoffAt: null,
        manifest: {
          contentHash: hex,
          artifactClass: "evidence_manifest",
        },
        factSets: [],
        dimensionExports: {},
      },
    ]);
    const preflight = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(new Map([[hex, bytes]])),
      requireCatalogVersions: false,
      requireByteIntegrity: true,
    });
    expect(preflight.ok).toBe(false);
    expect(preflight.blocking.some((b) => b.message.includes("byte integrity"))).toBe(true);
  });

  it("honest integrity-bound fixture passes requireByteIntegrity", async () => {
    const logical = createHash("sha256").update("logical").digest("hex");
    const manifestDoc = { schemaVersion: "2.0.0", contentHash: logical, slots: [] };
    const packed = pack(manifestDoc);
    const ref = buildCalibrationContentRefV2({
      bytes: packed.bytes,
      artifactClass: "evidence_manifest",
      logicalContentHash: logical,
      schemaVersion: "2.0.0",
    });
    const bundle = baseBundle([
      {
        memberId: "m1",
        characterId: "c1",
        expectedLabel: "good",
        rationale: "r",
        role: "DPS",
        classSlug: "mage",
        specSlug: "frost",
        included: true,
        exclusionCode: null,
        evidenceCutoffAt: null,
        manifest: ref,
        factSets: [],
        dimensionExports: {},
      },
    ]);
    const preflight = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(new Map([[ref.contentHash, packed.bytes]])),
      requireCatalogVersions: true,
      requireByteIntegrity: true,
    });
    expect(preflight.ok).toBe(true);
  });
});
