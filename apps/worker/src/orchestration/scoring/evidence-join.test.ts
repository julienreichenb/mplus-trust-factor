import { describe, expect, it } from "vitest";
import {
  aggregateEvidenceIssues,
  classifySnapshotStatus,
  incompleteBootstrap,
} from "./evidence-join.js";
import type { EvidenceJoinMemberResult } from "./evidence-join.js";
import { buildStoreZip, sha256Hex } from "./zip-store.js";

function member(partial: Partial<EvidenceJoinMemberResult>): EvidenceJoinMemberResult {
  return {
    memberId: "m1",
    identity: "EU/realm/name",
    expectedLabel: "GOOD",
    providedRole: "DPS",
    exclusionCode: null,
    included: true,
    foundInDb: true,
    characterId: "c1",
    bootstrapComplete: true,
    incompleteBootstrap: false,
    snapshotStatus: "COMPATIBLE_V6",
    latestSnapshotId: "s1",
    modelCompatible: true,
    seasonCompatible: true,
    freshEnough: true,
    requiresScoreRefresh: false,
    observationCountForSeason: 1,
    manifestId: "man1",
    manifestContentHash: "abc",
    factSetCount: 2,
    dimensionsPresent: ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"],
    fourDimensionsComplete: true,
    level: 80,
    persistedClassSlug: "mage",
    persistedSpecSlug: "frost",
    persistedRole: "DPS",
    ...partial,
  };
}

describe("evidence-join classification", () => {
  it("detects incomplete bootstrap", () => {
    expect(
      incompleteBootstrap({
        level: null,
        blizzardCharacterId: 1n,
        classId: "c",
        activeSpecId: "s",
        role: "DPS",
      }),
    ).toBe(true);
    expect(
      incompleteBootstrap({
        level: 80,
        blizzardCharacterId: 1n,
        classId: "c",
        activeSpecId: "s",
        role: "DPS",
      }),
    ).toBe(false);
  });

  it("classifies snapshot statuses", () => {
    expect(
      classifySnapshotStatus({ foundInDb: false, excluded: false, hasLatest: false, compatible: false }),
    ).toBe("IDENTITY_MISSING");
    expect(
      classifySnapshotStatus({ foundInDb: true, excluded: true, hasLatest: true, compatible: true }),
    ).toBe("EXCLUDED");
    expect(
      classifySnapshotStatus({ foundInDb: true, excluded: false, hasLatest: false, compatible: false }),
    ).toBe("NO_SNAPSHOT");
    expect(
      classifySnapshotStatus({ foundInDb: true, excluded: false, hasLatest: true, compatible: true }),
    ).toBe("COMPATIBLE_V6");
    expect(
      classifySnapshotStatus({ foundInDb: true, excluded: false, hasLatest: true, compatible: false }),
    ).toBe("STALE_OR_INCOMPATIBLE");
  });

  it("aggregates blockers and warnings", () => {
    const issues = aggregateEvidenceIssues(
      [
        member({ foundInDb: false, bootstrapComplete: null, incompleteBootstrap: null }),
        member({
          memberId: "m2",
          identity: "EU/realm/other",
          snapshotStatus: "NO_SNAPSHOT",
          manifestId: null,
          fourDimensionsComplete: false,
        }),
      ],
      false,
      ["Season missing"],
      false,
    );
    expect(issues.some((i) => i.code === "SEASON_BINDING_FAILED" && i.severity === "blocker")).toBe(
      true,
    );
    expect(issues.some((i) => i.code === "ACTIVE_MODEL_MISSING")).toBe(true);
    expect(issues.some((i) => i.code === "IDENTITY_MISSING")).toBe(true);
    expect(issues.some((i) => i.code === "SNAPSHOT_INCOMPATIBLE" && i.severity === "warning")).toBe(
      true,
    );
  });
});

describe("zip-store", () => {
  it("builds deterministic archives for identical inputs", () => {
    const files = [
      { name: "evidence-join.summary.json", content: '{"a":1}' },
      { name: "evidence-join.preflight.json", content: '{"b":2}' },
      { name: "evidence-join.preflight.md", content: "# ok\n" },
    ];
    const a = buildStoreZip(files);
    const b = buildStoreZip(files);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(a.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
  });
});
