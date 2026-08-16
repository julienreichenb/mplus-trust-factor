import { describe, expect, it } from "vitest";
import { groupCooldownTimelineBlocks, uniqueBossJumpChips } from "./cooldownTimeline";
import type { RunCooldownEventPublicDTO } from "@mplus/contracts";

const event = (
  timestampMs: number,
  segmentIndex: number | null,
  name: string,
): RunCooldownEventPublicDTO => ({
  kind: "COOLDOWN",
  timestampMs,
  dimension: "UTILITY",
  type: "utility",
  abilityId: 1,
  abilityName: name,
  iconUrl: null,
  segmentIndex,
});

describe("groupCooldownTimelineBlocks", () => {
  it("keeps unsegmented events as between-pulls and preserves pull indexes after filtering", () => {
    const blocks = groupCooldownTimelineBlocks(
      [
        event(5_000, null, "Gateway"),
        event(36_000, 1, "Tongues"),
        event(90_000, 2, "Tyrant"),
      ],
      [
        { index: 1, startMs: 30_000, endMs: 50_000 },
        { index: 2, startMs: 80_000, endMs: 95_000 },
      ],
    );
    expect(blocks.map((block) => block.kind)).toEqual(["between", "pull", "pull"]);
    expect(blocks[0]).toMatchObject({ kind: "between", events: [{ abilityName: "Gateway" }] });
    expect(blocks[1]).toMatchObject({ kind: "pull", segment: { index: 1 } });
    expect(blocks[2]).toMatchObject({ kind: "pull", segment: { index: 2 } });
  });

  it("omits pull blocks that have no remaining visible events", () => {
    const blocks = groupCooldownTimelineBlocks(
      [event(90_000, 2, "Tyrant")],
      [
        { index: 1, startMs: 30_000, endMs: 50_000 },
        { index: 2, startMs: 80_000, endMs: 95_000 },
      ],
    );
    expect(blocks.map((block) => (block.kind === "pull" ? block.segment.index : block.kind))).toEqual([
      2,
    ]);
    expect(blocks[0]).toMatchObject({ kind: "pull", segment: { index: 2 } });
  });
});

describe("uniqueBossJumpChips", () => {
  it("keeps the first pull for a repeated boss name", () => {
    expect(
      uniqueBossJumpChips([
        { index: 2, startMs: 20_000, endMs: 30_000, bossName: "Loom'ithar" },
        { index: 4, startMs: 50_000, endMs: 60_000, bossName: null },
        { index: 6, startMs: 80_000, endMs: 90_000, bossName: "Loom'ithar" },
        { index: 8, startMs: 100_000, endMs: 110_000, bossName: "Soulbinder" },
      ]),
    ).toEqual([
      { name: "Loom'ithar", segmentIndex: 2 },
      { name: "Soulbinder", segmentIndex: 8 },
    ]);
  });
});
