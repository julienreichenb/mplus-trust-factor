import { describe, expect, it } from "vitest";
import { reconcileDetailedAcquisitionFromDigests } from "./reconcile-detailed-acquisition.js";

describe("reconcileDetailedAcquisitionFromDigests", () => {
  it("marks selected runs with digests as detailed and matched", () => {
    const result = reconcileDetailedAcquisitionFromDigests({
      selectedRuns: [
        { canonicalRunId: "run-a", dungeonSlug: "algethar-academy" },
        { canonicalRunId: "run-b", dungeonSlug: "skyreach" },
      ],
      digests: [
        {
          dungeonSlug: "algethar-academy",
          reportCode: "AAA",
          fightId: 74,
          reportRevision: 1,
          utilityCompleteness: "COMPLETE",
          survivalCompleteness: "PARTIAL",
        },
      ],
      fightAccounting: [
        {
          reportCode: "AAA",
          fightId: 74,
          reportRevision: 1,
          packageCreated: true,
          digestsCreated: 5,
          digestsReused: 0,
        },
      ],
    });

    expect(result.detailedRunCount).toBe(1);
    expect(result.runCoverageById["run-a"]).toBe(1);
    expect(result.presentationMetaPatch["run-a"]).toEqual({
      wclReportMatched: true,
      wclCoverageRatio: 1,
      hasDetailedAnalysis: true,
    });
    expect(result.slotDiagnostics.find((s) => s.canonicalRunId === "run-a")?.state).toBe(
      "package_created",
    );
    expect(result.slotDiagnostics.find((s) => s.canonicalRunId === "run-b")?.state).toBe(
      "no_candidate",
    );
  });
});
