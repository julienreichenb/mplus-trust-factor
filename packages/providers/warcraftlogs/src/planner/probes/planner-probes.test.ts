/**
 * Probe helper tests — exercise sanitized cases without live provider I/O.
 * runPlannerProbeSuite itself requires ALLOW_LIVE_PROVIDER_CALLS.
 */
import { describe, expect, it } from "vitest";
import {
  probeArchivedOrGatedBehavior,
  probeCostAndBytesPerDataset,
  probeEventVersusTableParityScaffold,
  probeExactSameKeyParseField,
  probeMetadataBatchingByFightIds,
  probeTankHealerRankingShapes,
} from "./planner-probes.js";
import type { DiscoverySourceRow } from "../index.js";

const rows: DiscoverySourceRow[] = [
  {
    reportCode: "ProbeRepA",
    fightId: 1,
    dungeonSlug: "algethar-academy",
    keyLevel: 12,
    timed: true,
    runScore: 2400,
    completedAt: "2026-07-01T12:00:00.000Z",
    fightDurationMs: 1_800_000,
    actorId: 1,
    reportRevision: null,
    source: "zone_rankings",
    visibility: "public",
    parsePercentile: 90,
  },
  {
    reportCode: "ProbeRepA",
    fightId: 2,
    dungeonSlug: "algethar-academy",
    keyLevel: 11,
    timed: true,
    runScore: 2300,
    completedAt: "2026-07-01T11:00:00.000Z",
    fightDurationMs: 1_900_000,
    actorId: 1,
    reportRevision: null,
    source: "zone_rankings",
    visibility: "public",
  },
];

describe("planner probes (offline helpers)", () => {
  it("dedupes exact same-key parse field", () => {
    expect(probeExactSameKeyParseField(rows).ok).toBe(true);
  });

  it("batches metadata by multiple fight IDs", () => {
    const result = probeMetadataBatchingByFightIds(rows);
    expect(result.ok).toBe(true);
    expect(result.sanitized.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fightIds: [1, 2] }),
      ]),
    );
  });

  it("scaffolds event vs table cost parity", () => {
    expect(probeEventVersusTableParityScaffold().ok).toBe(true);
  });

  it("keeps bytes unknown distinct from zero", () => {
    const result = probeCostAndBytesPerDataset();
    expect(result.ok).toBe(true);
    const rowsOut = result.sanitized.rows as Array<{ estimatedBytes: { kind: string } }>;
    expect(rowsOut.every((r) => r.estimatedBytes.kind === "UNKNOWN")).toBe(true);
  });

  it("flags archived/gated access", () => {
    expect(probeArchivedOrGatedBehavior().ok).toBe(true);
  });

  it("validates tank/healer ranking payload shapes", () => {
    expect(
      probeTankHealerRankingShapes([
        { role: "TANK", rankings: [] },
        { role: "HEALER", rankings: [{ fightID: 1 }] },
      ]).ok,
    ).toBe(true);
    expect(probeTankHealerRankingShapes([{ role: "TANK", rankings: null }]).ok).toBe(false);
  });
});
