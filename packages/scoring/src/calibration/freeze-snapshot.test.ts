import { describe, expect, it } from "vitest";
import { createDefaultModelV6 } from "../model/defaults.js";
import {
  createDefaultScoringV2DimensionConfigSet,
  withScoringV2DimensionConfigs,
} from "../model-config/index.js";
import { resolveFrozenDimensionConfigsForModel } from "./bundle-v2.js";
import {
  FREEZE_SNAPSHOT_SCHEMA_VERSION,
  buildDefaultFreezePolicies,
  buildFreezeSnapshot,
  parseAndVerifyFreezeSnapshot,
} from "./freeze-snapshot.js";

describe("freeze-snapshot", () => {
  it("round-trips contentHash verification", () => {
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
    expect(snap.schemaVersion).toBe(FREEZE_SNAPSHOT_SCHEMA_VERSION);
    expect(snap.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parseAndVerifyFreezeSnapshot(snap).ok).toBe(true);
    expect(parseAndVerifyFreezeSnapshot({}).code).toBe("FREEZE_SNAPSHOT_MISSING");
    expect(
      parseAndVerifyFreezeSnapshot({ ...snap, contentHash: "a".repeat(64) }).code,
    ).toBe("FREEZE_SNAPSHOT_HASH_MISMATCH");
  });
});
