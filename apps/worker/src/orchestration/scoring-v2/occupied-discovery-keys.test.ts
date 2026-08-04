import { describe, expect, it } from "vitest";
import { collectOccupiedDiscoveryKeys } from "./occupied-discovery-keys.js";

describe("collectOccupiedDiscoveryKeys", () => {
  it("includes sibling acquired and reserved keys, excluding self", () => {
    const keys = collectOccupiedDiscoveryKeys(
      [
        {
          slotId: "ara:0",
          acquiredDiscoveryKey: "r1:1",
          reservedDiscoveryKey: null,
        },
        {
          slotId: "ara:1",
          acquiredDiscoveryKey: null,
          reservedDiscoveryKey: "r2:2",
        },
        {
          slotId: "other:0",
          acquiredDiscoveryKey: "r3:3",
          reservedDiscoveryKey: "r3:3",
        },
      ],
      "ara:1",
    );
    expect([...keys].sort()).toEqual(["r1:1", "r3:3"]);
  });

  it("returns empty when no sibling has claimed an identity", () => {
    expect(
      collectOccupiedDiscoveryKeys(
        [
          { slotId: "a:0", acquiredDiscoveryKey: null, reservedDiscoveryKey: null },
          { slotId: "a:1", acquiredDiscoveryKey: null, reservedDiscoveryKey: null },
        ],
        "a:0",
      ).size,
    ).toBe(0);
  });
});
