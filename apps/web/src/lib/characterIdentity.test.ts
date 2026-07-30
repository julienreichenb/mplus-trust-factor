import { describe, expect, it } from "vitest";
import {
  characterIdentityKey,
  normalizeCharacterIdentity,
  sameCharacterIdentity,
} from "./characterIdentity";

describe("characterIdentity", () => {
  it("normalizes region, realm slug and name", () => {
    expect(normalizeCharacterIdentity({ region: "eu", realm: "Tarren Mill", name: " Aleria " })).toEqual({
      region: "EU",
      realmSlug: "tarren-mill",
      name: "aleria",
    });
  });

  it("matches identities case-insensitively on name", () => {
    expect(
      sameCharacterIdentity(
        { region: "EU", realmSlug: "tarren-mill", name: "Aleria" },
        { region: "eu", realm: "Tarren Mill", name: "aleria" },
      ),
    ).toBe(true);
    expect(
      sameCharacterIdentity(
        { region: "EU", realmSlug: "tarren-mill", name: "Aleria" },
        { region: "EU", realmSlug: "kazzak", name: "Aleria" },
      ),
    ).toBe(false);
  });

  it("builds a stable comparison key", () => {
    expect(characterIdentityKey({ region: "EU", realmSlug: "kazzak", name: "CarryMe" })).toBe(
      "EU|kazzak|carryme",
    );
  });
});
