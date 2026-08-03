import { describe, expect, it } from "vitest";
import { createDefaultModelV6 } from "../model/defaults.js";
import {
  createDefaultScoringV2DimensionConfigSet,
  withScoringV2DimensionConfigs,
} from "../model-config/index.js";
import {
  buildCalibrationContentRefV2,
  resolveFrozenDimensionConfigsForModel,
} from "./bundle-v2.js";
import {
  FREEZE_SNAPSHOT_SCHEMA_VERSION,
  buildDefaultFreezePolicies,
  buildFreezeSnapshot,
  parseAndVerifyFreezeSnapshot,
  type FreezeSnapshotContentRefV2,
  type FreezeSnapshotMemberEvidenceV2,
} from "./freeze-snapshot.js";

function ref(
  payload: unknown,
  artifactClass: FreezeSnapshotContentRefV2["artifactClass"],
  logical?: string | null,
): FreezeSnapshotContentRefV2 {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  const built = buildCalibrationContentRefV2({
    bytes,
    artifactClass,
    logicalContentHash: logical ?? null,
    schemaVersion: "2.0.0",
    storageUri: "memory://x",
  });
  return {
    contentHash: built.contentHash,
    logicalContentHash: built.logicalContentHash ?? null,
    byteDigest: built.byteDigest!,
    digestAlgorithm: "sha256",
    artifactClass: built.artifactClass,
    schemaVersion: built.schemaVersion ?? null,
    byteLength: built.byteLength ?? bytes.byteLength,
    storageUri: built.storageUri ?? null,
  };
}

function sampleEvidence(): FreezeSnapshotMemberEvidenceV2 {
  return {
    manifest: ref({ kind: "manifest" }, "evidence_manifest", "a".repeat(64)),
    factSets: [ref({ kind: "fact" }, "run_fact_set")],
    dimensionExports: {
      PERFORMANCE: ref({ dimension: "PERFORMANCE" }, "dimension_replay_export"),
      SURVIVAL: ref({ dimension: "SURVIVAL" }, "dimension_replay_export"),
      UTILITY: ref({ dimension: "UTILITY" }, "dimension_replay_export"),
      EXPERIENCE: ref({ dimension: "EXPERIENCE" }, "dimension_replay_export"),
    },
    previousSnapshot: ref({ id: "snap-1" }, "other"),
  };
}

describe("freeze-snapshot", () => {
  it("round-trips contentHash verification for v2 with evidence", () => {
    const config = withScoringV2DimensionConfigs(
      createDefaultModelV6({ key: "m", version: 1 }),
      createDefaultScoringV2DimensionConfigSet(),
    );
    const modelRef = {
      id: "model-1",
      key: "m",
      version: 1,
      status: "ACTIVE" as const,
      config,
      isActive: true,
    };
    const snap = buildFreezeSnapshot({
      cohortId: "c1",
      cohortExternalKey: null,
      cohortName: "C",
      cohortDescription: "",
      cohortCreatedAt: "2026-08-01T00:00:00.000Z",
      cohortRevision: 1,
      members: [
        {
          id: "m1",
          externalMemberKey: null,
          characterId: "ch1",
          region: "eu",
          realmSlug: "realm",
          characterName: "Hero",
          expectedLabel: "GOOD",
          rationale: "",
          included: true,
          exclusionCode: null,
          role: "DPS",
          classSlug: "mage",
          specSlug: "frost",
          evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
          source: "USER_SELECTED",
          evidence: sampleEvidence(),
        },
        {
          id: "m2",
          externalMemberKey: null,
          characterId: null,
          region: "eu",
          realmSlug: "realm",
          characterName: "Excluded",
          expectedLabel: "WEAK",
          rationale: "",
          included: false,
          exclusionCode: "SUSPECTED_BOOST",
          role: "DPS",
          classSlug: "mage",
          specSlug: "fire",
          evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
          source: "USER_SELECTED",
          evidence: null,
        },
      ],
      season: { seasonId: "s1", seasonSlug: "s", region: "eu" },
      activeModel: {
        ...modelRef,
        dimensionConfigs: resolveFrozenDimensionConfigsForModel(modelRef, "calibration-strict"),
      },
      evaluationModel: null,
      policies: buildDefaultFreezePolicies({
        abilityCatalogVersions: ["abilities-v1"],
        mechanicCatalogVersions: ["0.1.0-seed"],
      }),
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      generatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(snap.schemaVersion).toBe("scoring-v2-freeze-snapshot-v2");
    expect(snap.schemaVersion).toBe(FREEZE_SNAPSHOT_SCHEMA_VERSION);
    expect(snap.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snap.members[0]!.evidence?.manifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snap.members[1]!.evidence).toBeNull();
    expect(parseAndVerifyFreezeSnapshot(snap).ok).toBe(true);
    expect(parseAndVerifyFreezeSnapshot({}).code).toBe("FREEZE_SNAPSHOT_MISSING");
    expect(
      parseAndVerifyFreezeSnapshot({ ...snap, contentHash: "a".repeat(64) }).code,
    ).toBe("FREEZE_SNAPSHOT_HASH_MISMATCH");
  });

  it("rejects included members without evidence package", () => {
    const config = withScoringV2DimensionConfigs(
      createDefaultModelV6({ key: "m", version: 1 }),
      createDefaultScoringV2DimensionConfigSet(),
    );
    const modelRef = {
      id: "model-1",
      key: "m",
      version: 1,
      status: "ACTIVE" as const,
      config,
      isActive: true,
    };
    const snap = buildFreezeSnapshot({
      cohortId: "c1",
      cohortExternalKey: null,
      cohortName: "C",
      cohortDescription: "",
      cohortCreatedAt: "2026-08-01T00:00:00.000Z",
      cohortRevision: 1,
      members: [
        {
          id: "m1",
          externalMemberKey: null,
          characterId: "ch1",
          region: "eu",
          realmSlug: "realm",
          characterName: "Hero",
          expectedLabel: "GOOD",
          rationale: "",
          included: true,
          exclusionCode: null,
          role: "DPS",
          classSlug: "mage",
          specSlug: "frost",
          evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
          source: "USER_SELECTED",
          evidence: null,
        },
      ],
      season: { seasonId: "s1", seasonSlug: "s", region: "eu" },
      activeModel: {
        ...modelRef,
        dimensionConfigs: resolveFrozenDimensionConfigsForModel(modelRef, "calibration-strict"),
      },
      evaluationModel: null,
      policies: buildDefaultFreezePolicies({
        abilityCatalogVersions: ["abilities-v1"],
        mechanicCatalogVersions: ["0.1.0-seed"],
      }),
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      generatedAt: "2026-08-01T00:00:00.000Z",
    });
    // buildFreezeSnapshot does not validate; parse must reject.
    expect(parseAndVerifyFreezeSnapshot(snap).code).toBe("FREEZE_SNAPSHOT_INVALID");
  });

  it("rejects v1 schemaVersion", () => {
    expect(
      parseAndVerifyFreezeSnapshot({
        schemaVersion: "scoring-v2-freeze-snapshot-v1",
        contentHash: "a".repeat(64),
      }).code,
    ).toBe("FREEZE_SNAPSHOT_INVALID");
  });
});
