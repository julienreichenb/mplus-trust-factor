import { describe, expect, it } from "vitest";
import { PRIMARY_DUNGEON_RUN_WEIGHT, SECONDARY_DUNGEON_RUN_WEIGHT, dungeonRunSlotWeight } from "../policy.js";
import { inspectComparablePeerGapRuns } from "./peer-gap.js";
import type { BoostPeerParse, BoostRunInput } from "../types.js";

function peerParses(ids: string[], keyParse: number): BoostPeerParse[] {
  return ids.map((id) => ({
    identityKey: `cid:${id}`,
    displayName: id,
    keyParse,
    role: "DPS",
  }));
}

function run(slotIndex: 0 | 1, subject: number, peer: number, dungeon: string): BoostRunInput {
  return {
    runId: `${dungeon}-${slotIndex}`,
    seasonId: "season-1",
    dungeonSlug: dungeon,
    dungeonName: dungeon,
    keyLevel: 20,
    timed: true,
    completedAt: "2026-08-01T00:00:00.000Z",
    subjectKeyParse: subject,
    parseSemantic: "BRACKET_PERCENT",
    deathCount: 0,
    survivalAvailable: true,
    peerKeyParses: peerParses(["a", "b"], peer),
    participants: [],
    slotIndex,
  };
}

describe("signed peer-gap inspections", () => {
  it("uses PRIMARY=1.0 and SECONDARY=0.25", () => {
    expect(PRIMARY_DUNGEON_RUN_WEIGHT).toBe(1);
    expect(SECONDARY_DUNGEON_RUN_WEIGHT).toBe(0.25);
    expect(dungeonRunSlotWeight(0)).toBe(1);
    expect(dungeonRunSlotWeight(1)).toBe(0.25);
  });

  it("positive performanceDelta is green", () => {
    const rows = inspectComparablePeerGapRuns([run(0, 95, 70, "d0")]);
    expect(rows[0]!.performanceDelta).toBe(25);
    expect(rows[0]!.greenSeverity).toBeGreaterThan(0);
    expect(rows[0]!.redSeverity).toBe(0);
  });

  it("classifies extreme from signed delta without absolute subject/peer gates", () => {
    const rows = inspectComparablePeerGapRuns([run(0, 35, 85, "d0")]);
    expect(rows[0]!.performanceDelta).toBe(-50);
    expect(rows[0]!.classification).toBe("RED_EXTREME");
  });
});
