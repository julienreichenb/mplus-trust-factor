import { describe, expect, it } from "vitest";
import { FIXTURE_CHARACTERS } from "../api/mock/fixtures";
import { resolveExternalProfileLinks } from "./externalProfileLinks";

describe("resolveExternalProfileLinks", () => {
  it("prefers provider source URLs when present", () => {
    const profile = FIXTURE_CHARACTERS[0]!.profile;
    const links = resolveExternalProfileLinks(profile);
    expect(links.find((l) => l.id === "warcraftlogs")?.href).toContain("warcraftlogs.com");
    expect(links.find((l) => l.id === "raiderio")?.href).toContain("raider.io");
    expect(links.find((l) => l.id === "armory")?.href).toContain("worldofwarcraft.blizzard.com");
  });

  it("builds fallback slug URLs when sources omit links", () => {
    const profile = {
      ...FIXTURE_CHARACTERS[0]!.profile,
      sources: [],
      providerStates: undefined,
      profileUrl: null,
    };
    const links = resolveExternalProfileLinks(profile);
    expect(links.map((l) => l.label)).toEqual(["warcraftlogs.com", "raider.io", "blizzard.com"]);
    expect(links[0]!.href).toMatch(/warcraftlogs\.com\/character\/eu\/tarren-mill\/aleria/i);
    expect(links[1]!.href).toMatch(/raider\.io\/characters\/eu\/tarren-mill\/Aleria/);
    expect(links[2]!.href).toMatch(/character\/eu\/tarren-mill\/aleria/i);
  });
});
