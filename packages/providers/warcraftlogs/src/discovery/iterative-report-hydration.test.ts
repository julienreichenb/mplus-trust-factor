/**
 * Iterative hydration — middle-position report must not stay permanently unhydrated.
 */
import { describe, expect, it, vi } from "vitest";
import {
  hydrateFightUnknownCandidates,
  hydrateFightUnknownCandidatesIterative,
  orderStubsForIterativeHydration,
  type HydrationReportPayload,
} from "@mplus/provider-warcraftlogs";
import type { WclRunCandidate } from "@mplus/provider-warcraftlogs";

const WINDRUNNER_A = "fWJTbkMCP3a4A1Rd";
const WINDRUNNER_B = "7qtb9Wp4ZdYwmKPH";

function stub(reportCode: string, startTimeMs: number): WclRunCandidate {
  return {
    reportCode,
    fightId: 0,
    encounterId: 0,
    zoneId: null,
    dungeonSlug: null,
    seasonSlug: null,
    keyLevel: null,
    score: null,
    startTimeMs,
    completedAt: new Date(startTimeMs + 1_800_000).toISOString(),
    durationMs: null,
    timed: null,
    selectionTags: [],
    source: "recentReports",
    matchConfidence: null,
    targetActorId: null,
    incompleteness: {
      dungeonUnknown: true,
      seasonUnknown: true,
      timedUnknown: true,
      keyLevelUnknown: true,
      rosterIncomplete: true,
      fightUnknown: true,
    },
    warnings: ["stub"],
  };
}

function reportPayload(
  code: string,
  encounterID: number,
  fightId: number,
): HydrationReportPayload {
  let hash = 0;
  for (let i = 0; i < code.length; i += 1) {
    hash = (hash * 31 + code.charCodeAt(i)) | 0;
  }
  return {
    code,
    // Distinct absolute start per report so timed coverage identities stay unique.
    startTime: 1_750_000_000_000 + Math.abs(hash) * 60_000 + fightId * 1_000,
    visibility: "public",
    zone: { id: 47, name: "Mythic+" },
    fights: [
      {
        id: fightId,
        encounterID,
        name: encounterID === 12805 ? "Windrunner Spire" : "Skyreach",
        keystoneLevel: 18,
        keystoneBonus: 1,
        startTime: 0,
        endTime: 1_800_000,
        friendlyPlayers: [1],
      },
    ],
    masterData: {
      actors: [{ id: 1, name: "Wallidrixe", type: "Player", server: "Archimonde" }],
    },
  };
}

/**
 * 44 stubs, all dungeonSlug=null.
 * Place WINDRUNNER_A inside the initial RR set and WINDRUNNER_B at listed-order
 * index 24 (first incremental batch) so a 24-cap omits it while iterative finds it.
 */
function wallidrixeFortyFourStubs(): {
  stubs: WclRunCandidate[];
  listedOrder: string[];
  middleIndex: number;
} {
  // Build 44 placeholders, then assign codes after computing RR order positions.
  const base = Array.from({ length: 44 }, (_, i) => stub(`TMP${i}`, 10_000_000 - i * 1_000));
  const order = orderStubsForIterativeHydration(base, []).map((s) => s.reportCode);
  // Map TMP indices: order[k] is TMPi → startTime already set on base[i].
  const byTmp = new Map(base.map((s) => [s.reportCode, s]));
  const stubs: WclRunCandidate[] = order.map((tmpCode, listedIdx) => {
    const original = byTmp.get(tmpCode)!;
    let reportCode = `FILL${String(listedIdx).padStart(2, "0")}`;
    if (listedIdx === 3) reportCode = WINDRUNNER_A;
    if (listedIdx === 24) reportCode = WINDRUNNER_B;
    return stub(reportCode, original.startTimeMs ?? 0);
  });
  const listedOrder = orderStubsForIterativeHydration(stubs, []).map((s) => s.reportCode);
  const middleIndex = listedOrder.indexOf(WINDRUNNER_B);
  expect(middleIndex).toBe(24);
  expect(listedOrder.slice(0, 24)).toContain(WINDRUNNER_A);
  expect(listedOrder.slice(0, 24)).not.toContain(WINDRUNNER_B);
  return { stubs, listedOrder, middleIndex };
}

describe("iterative hydration past initial 24", () => {
  it("a report outside the initial 24 can still be hydrated", async () => {
    const { stubs, listedOrder } = wallidrixeFortyFourStubs();
    const fetched: string[] = [];
    const result = await hydrateFightUnknownCandidatesIterative({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "Archimonde",
      activeDungeonSlugs: ["windrunner-spire", "skyreach"],
      initialBudget: 24,
      incrementalBatchSize: 6,
      evaluateIncrementalAdmission: () => ({
        allow: true,
        action: "OK",
        reasons: ["ok"],
        projectedIncrementalPoints: 18,
      }),
      fetchReport: async (code) => {
        fetched.push(code);
        if (code === WINDRUNNER_A || code === WINDRUNNER_B) {
          return reportPayload(code, 12805, code === WINDRUNNER_A ? 3 : 5);
        }
        // Other reports fill skyreach so coverage needs Windrunner second.
        return reportPayload(code, 61209, 1);
      },
    });

    expect(listedOrder.slice(0, 24)).not.toContain(WINDRUNNER_B);
    expect(fetched).toContain(WINDRUNNER_B);
    expect(result.diagnostics.incrementalBatchCount).toBeGreaterThan(0);
    expect(result.diagnostics.terminalHydrationReason).toBe("full_coverage");
    expect(
      result.diagnostics.coverage.distinctCandidatesPerDungeon["windrunner-spire"],
    ).toBeGreaterThanOrEqual(2);
  });

  it("former 24-report terminal-cap leaves middle Windrunner omitted (regression)", async () => {
    const { stubs } = wallidrixeFortyFourStubs();
    const fetched: string[] = [];
    const capped = await hydrateFightUnknownCandidates({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "Archimonde",
      activeDungeonSlugs: ["windrunner-spire", "skyreach"],
      maxReports: 24,
      fetchReport: async (code) => {
        fetched.push(code);
        if (code === WINDRUNNER_A || code === WINDRUNNER_B) {
          return reportPayload(code, 12805, code === WINDRUNNER_A ? 3 : 5);
        }
        return reportPayload(code, 61209, 1);
      },
    });
    expect(fetched).not.toContain(WINDRUNNER_B);
    expect(capped.diagnostics.omittedReports.some((o) => o.reportCode === WINDRUNNER_B)).toBe(
      true,
    );
    expect(
      capped.diagnostics.distinctCandidatesPerDungeon["windrunner-spire"] ?? 0,
    ).toBeLessThan(2);
  });

  it("a report in the middle of newest/oldest ordering is not permanently skipped", async () => {
    const { stubs, middleIndex } = wallidrixeFortyFourStubs();
    expect(middleIndex).toBeGreaterThanOrEqual(24);
    const result = await hydrateFightUnknownCandidatesIterative({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "Archimonde",
      activeDungeonSlugs: ["windrunner-spire", "skyreach"],
      initialBudget: 24,
      incrementalBatchSize: 4,
      evaluateIncrementalAdmission: () => ({
        allow: true,
        action: "OK",
        reasons: ["ok"],
        projectedIncrementalPoints: 12,
      }),
      fetchReport: async (code) => {
        if (code === WINDRUNNER_A || code === WINDRUNNER_B) {
          return reportPayload(code, 12805, code === WINDRUNNER_A ? 3 : 5);
        }
        return reportPayload(code, 61209, 1);
      },
    });
    expect(result.diagnostics.omittedReports.some((o) => o.reportCode === WINDRUNNER_B)).toBe(
      false,
    );
  });

  it("additional batches run only while slots are missing; stop at full coverage", async () => {
    const { stubs } = wallidrixeFortyFourStubs();
    let admitCalls = 0;
    const result = await hydrateFightUnknownCandidatesIterative({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "Archimonde",
      activeDungeonSlugs: ["windrunner-spire", "skyreach"],
      initialBudget: 24,
      incrementalBatchSize: 6,
      evaluateIncrementalAdmission: () => {
        admitCalls += 1;
        return {
          allow: true,
          action: "OK",
          reasons: ["ok"],
          projectedIncrementalPoints: 18,
        };
      },
      fetchReport: async (code) => {
        if (code === WINDRUNNER_A || code === WINDRUNNER_B) {
          return reportPayload(code, 12805, code === WINDRUNNER_A ? 3 : 5);
        }
        return reportPayload(code, 61209, 1);
      },
    });
    expect(result.diagnostics.terminalHydrationReason).toBe("full_coverage");
    expect(admitCalls).toBe(result.diagnostics.incrementalBatchCount);
    // B is at listed index 24 → one incremental batch should suffice.
    expect(result.diagnostics.totalReportsHydrated).toBeLessThan(44);
    expect(result.diagnostics.totalReportsHydrated).toBeLessThanOrEqual(30);
  });

  it("hydration stops after every report is exhausted", async () => {
    const stubs = Array.from({ length: 10 }, (_, i) => stub(`ONLY${i}`, 1000 - i));
    // Only skyreach encounter — windrunner never fills → exhausts reports.
    const result = await hydrateFightUnknownCandidatesIterative({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "Archimonde",
      activeDungeonSlugs: ["windrunner-spire", "skyreach"],
      initialBudget: 4,
      incrementalBatchSize: 3,
      evaluateIncrementalAdmission: () => ({
        allow: true,
        action: "OK",
        reasons: ["ok"],
        projectedIncrementalPoints: 9,
      }),
      fetchReport: async (code) => reportPayload(code, 61209, 1),
    });
    expect(result.diagnostics.terminalHydrationReason).toBe("reports_exhausted");
    expect(result.diagnostics.reportsRemaining).toBe(0);
  });

  it("DEFER/STOP prevents the next incremental batch", async () => {
    const { stubs } = wallidrixeFortyFourStubs();
    const fetched: string[] = [];
    const result = await hydrateFightUnknownCandidatesIterative({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "Archimonde",
      activeDungeonSlugs: ["windrunner-spire", "skyreach"],
      initialBudget: 24,
      incrementalBatchSize: 6,
      evaluateIncrementalAdmission: () => ({
        allow: false,
        action: "DEFER",
        reasons: ["projected_utilization_DEFER"],
        projectedIncrementalPoints: 18,
      }),
      fetchReport: async (code) => {
        fetched.push(code);
        if (code === WINDRUNNER_A) return reportPayload(code, 12805, 3);
        return reportPayload(code, 61209, 1);
      },
    });
    expect(result.diagnostics.terminalHydrationReason).toBe("rate_admission_defer");
    expect(result.diagnostics.incrementalBatchCount).toBe(0);
    expect(fetched).not.toContain(WINDRUNNER_B);
    expect(result.diagnostics.reportsRemaining).toBeGreaterThan(0);
  });

  it("progress persists across batches (already-hydrated codes not re-fetched)", async () => {
    const { stubs } = wallidrixeFortyFourStubs();
    const fetchCounts = new Map<string, number>();
    await hydrateFightUnknownCandidatesIterative({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "Archimonde",
      activeDungeonSlugs: ["windrunner-spire", "skyreach"],
      initialBudget: 24,
      incrementalBatchSize: 6,
      evaluateIncrementalAdmission: () => ({
        allow: true,
        action: "OK",
        reasons: ["ok"],
        projectedIncrementalPoints: 18,
      }),
      fetchReport: async (code) => {
        fetchCounts.set(code, (fetchCounts.get(code) ?? 0) + 1);
        if (code === WINDRUNNER_A || code === WINDRUNNER_B) {
          return reportPayload(code, 12805, code === WINDRUNNER_A ? 3 : 5);
        }
        return reportPayload(code, 61209, 1);
      },
    });
    for (const [, n] of fetchCounts) {
      expect(n).toBe(1);
    }
  });
});

describe("incremental admission helper surface", () => {
  it("capability acquisition remains unreachable from iterative hydrator", async () => {
    const acquire = vi.fn();
    const stubs = [stub("A", 100), stub("B", 90)];
    await hydrateFightUnknownCandidatesIterative({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "Archimonde",
      activeDungeonSlugs: ["skyreach"],
      initialBudget: 1,
      incrementalBatchSize: 1,
      evaluateIncrementalAdmission: () => ({
        allow: true,
        action: "OK",
        reasons: ["ok"],
        projectedIncrementalPoints: 3,
      }),
      fetchReport: async (code) => reportPayload(code, 61209, 1),
    });
    expect(acquire).not.toHaveBeenCalled();
  });
});
