import { describe, expect, it } from "vitest";
import {
  requireAuthorityDungeonEncounterBindings,
  SeasonDungeonBindingsMissingError,
  type ActiveMplusDungeonIdentity,
} from "./types.js";

describe("requireAuthorityDungeonEncounterBindings", () => {
  it("returns bindings for every dungeon with a WCL encounter ID", () => {
    const dungeons: ActiveMplusDungeonIdentity[] = [
      { slug: "skyreach", dungeonId: "d1", sortOrder: 0, wclEncounterId: 61209 },
      { slug: "windrunner-spire", dungeonId: "d2", sortOrder: 1, wclEncounterId: 12805 },
    ];
    expect(requireAuthorityDungeonEncounterBindings(dungeons)).toEqual([
      { dungeonSlug: "skyreach", encounterId: 61209 },
      { dungeonSlug: "windrunner-spire", encounterId: 12805 },
    ]);
  });

  it("fails when any dungeon is missing an encounter ID", () => {
    const dungeons: ActiveMplusDungeonIdentity[] = [
      { slug: "skyreach", dungeonId: "d1", sortOrder: 0, wclEncounterId: 61209 },
      { slug: "future-dungeon", dungeonId: "d2", sortOrder: 1, wclEncounterId: null },
    ];
    expect(() => requireAuthorityDungeonEncounterBindings(dungeons)).toThrow(
      SeasonDungeonBindingsMissingError,
    );
  });
});
