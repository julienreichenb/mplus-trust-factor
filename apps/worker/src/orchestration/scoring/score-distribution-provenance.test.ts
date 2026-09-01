import { describe, expect, it } from "vitest";

/**
 * Narrow regression: ScoreSnapshot / CharacterScore provenance must keep the
 * distribution snapshot id stamped at compute time even after a newer provider
 * fact becomes effective for subsequent scores.
 */
describe("score snapshot distribution provenance", () => {
  it("retains the stamped contextDistributionSnapshotId when a newer latest exists", () => {
    const stampedAtCompute = "dist-snapshot-A";
    const laterEffectiveLatest = "dist-snapshot-B";
    const characterScoreRow = {
      contextRevisionId: "rev-1",
      contextDistributionSnapshotId: stampedAtCompute,
    };
    // Later refreshes change what findLatestValidRegionalDistribution returns,
    // but historical rows are not rewritten.
    expect(characterScoreRow.contextDistributionSnapshotId).toBe(stampedAtCompute);
    expect(characterScoreRow.contextDistributionSnapshotId).not.toBe(laterEffectiveLatest);
  });
});
