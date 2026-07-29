/**
 * Worker tests for Utility shadow refresh boundary.
 */
import { describe, expect, it } from "vitest";
import {
  applyUtilityShadowRefreshBoundary,
  shadowDiagnosticsForScoreExplanation,
} from "./utility-shadow-refresh.js";
import type { MetricObservationDTO } from "@mplus/contracts";

describe("utility shadow refresh boundary", () => {
  it("does not alter public Trust path flags and strips research modes", () => {
    const observations: MetricObservationDTO[] = [
      {
        metricKey: "utility.interrupts",
        dimension: "UTILITY",
        rawValue: 3,
        normalizedValue: 60,
        confidence: 0.7,
        observedAt: new Date().toISOString(),
        sourceProvider: "warcraftlogs",
        coverage: null,
        context: { from: "combat-facts" },
      },
      {
        metricKey: "utility.observed",
        dimension: "UTILITY",
        rawValue: 70,
        normalizedValue: 70,
        confidence: 0.8,
        observedAt: new Date().toISOString(),
        sourceProvider: "warcraftlogs",
        coverage: null,
        context: { utilityScoringMode: "OBSERVED_CONTRIBUTION" },
      },
    ];

    const { shadow, publicUtilitySafeObservations } = applyUtilityShadowRefreshBoundary({
      observations,
      hasPersistedSharedEvidence: false,
      shadowScoreInput: {
        mode: "shadow",
        hasPersistedSharedEvidence: false,
        runs: [],
        rawByRunId: new Map(),
        masterByReport: new Map(),
        opportunities: [],
        detailedWclEventCallsMade: 0,
      },
    });

    expect(publicUtilitySafeObservations).toHaveLength(1);
    expect(publicUtilitySafeObservations[0]!.metricKey).toBe("utility.interrupts");
    expect(shadow.altersPublicTrustScore).toBe(false);
    expect(shadow.altersPublicUtility).toBe(false);
    expect(shadow.status).toBe("SKIPPED_NO_PERSISTED_EVIDENCE");

    const diag = shadowDiagnosticsForScoreExplanation(shadow);
    expect(diag.adminDiagnosticsOnly).toBe(true);
    expect(diag.altersPublicTrustScore).toBe(false);
  });

  it("published mode scores when evidence present; empty runs skip cleanly", () => {
    const { shadow, published } = applyUtilityShadowRefreshBoundary({
      observations: [],
      hasPersistedSharedEvidence: true,
      shadowScoreInput: {
        mode: "published",
        hasPersistedSharedEvidence: true,
        runs: [],
        rawByRunId: new Map(),
        masterByReport: new Map(),
        opportunities: [],
      },
    });
    expect(shadow.status).toBe("SKIPPED_EMPTY_RUNS");
    expect(shadow.score).toBeNull();
    expect(published).toBe(false);
  });
});
