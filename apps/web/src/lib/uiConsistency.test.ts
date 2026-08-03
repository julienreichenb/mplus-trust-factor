import { describe, expect, it } from "vitest";
import {
  displayCapitalize,
  formatCharacterIdentityDisplay,
} from "./characterIdentity";
import { presentStatusChip } from "./statusChip";

describe("character identity formatting", () => {
  it("formats canonical portrait region nickname-server order", () => {
    const d = formatCharacterIdentityDisplay({
      region: "eu",
      name: "aleria",
      realmSlug: "tarren-mill",
      realmName: "Tarren Mill",
      classSlug: "mage",
      className: "Mage",
      classColor: "#3FC7EB",
      avatarUrl: "https://example.test/a.jpg",
    });
    expect(d.region).toBe("EU");
    expect(d.nickname).toBe("Aleria");
    expect(d.server).toBe("Tarren Mill");
    expect(d.nicknameServer).toBe("Aleria-Tarren Mill");
    expect(d.accessibleLabel).toContain("Mage");
    expect(d.accessibleLabel).toContain("EU");
    expect(d.realmSlug).toBe("tarren-mill");
    expect(d.nameForRoute).toBe("aleria");
    expect(d.portraitSrc).toContain("example.test");
  });

  it("display-capitalizes hyphenated segments without mutating storage intent", () => {
    expect(displayCapitalize("tarren-mill")).toBe("Tarren-Mill");
    expect(displayCapitalize("Wallidrixe")).toBe("Wallidrixe");
  });
});

describe("status chip mapping", () => {
  it("maps success / warning / danger semantics without Refresh prefix", () => {
    expect(presentStatusChip("COMPLETED")).toEqual({ label: "Completed", tone: "success" });
    expect(presentStatusChip("AVAILABLE")).toEqual({ label: "Available", tone: "success" });
    expect(presentStatusChip("FRESH")).toEqual({ label: "Up to date", tone: "success" });
    expect(presentStatusChip("QUEUED")).toEqual({ label: "Queued", tone: "warning" });
    expect(presentStatusChip("REFRESHING")).toEqual({ label: "Refreshing", tone: "warning" });
    expect(presentStatusChip("STALE")).toEqual({ label: "Stale", tone: "warning" });
    expect(presentStatusChip("FAILED")).toEqual({ label: "Failed", tone: "danger" });
    expect(presentStatusChip("CANCELLED")).toEqual({ label: "Cancelled", tone: "danger" });
    expect(presentStatusChip("QUEUED").label).not.toMatch(/refresh/i);
  });

  it("maps concurrency sync states without success for non-SYNCHRONIZED", () => {
    expect(presentStatusChip("SYNCHRONIZED")).toEqual({ label: "Synchronized", tone: "success" });
    expect(presentStatusChip("PARTIALLY_OBSERVED")).toEqual({
      label: "Partially observed",
      tone: "warning",
    });
    expect(presentStatusChip("STALE").tone).toBe("warning");
    expect(presentStatusChip("UNSYNCHRONIZED")).toEqual({
      label: "Unsynchronized",
      tone: "danger",
    });
    expect(presentStatusChip("UNKNOWN")).toEqual({ label: "Unknown", tone: "neutral" });
  });
});
