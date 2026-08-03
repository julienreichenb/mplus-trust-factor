import { describe, expect, it } from "vitest";
import {
  buildCooldownUsageAdminRows,
  buildCooldownUsagePublicRows,
} from "./cooldown-usage.js";

describe("cooldown usage explainability", () => {
  it("emits factual use counts for Warlock Demonology catalog abilities", () => {
    const admin = buildCooldownUsageAdminRows({
      dungeonSlug: "skyreach",
      slotIndex: 0,
      keyLevel: 15,
      reportCode: "AbCdEf12",
      fightId: 3,
      reportRevision: 1,
      classSlug: "warlock",
      specSlug: "demonology",
      catalogVersion: "test",
      extractorVersion: "utility-v2",
      evidenceCoverageState: "COMPLETE",
      sourceDataset: "Casts",
      useCountsByCanonicalKey: {
        "warlock.interrupt.axe-toss": 4,
        "warlock.hard-cc.shadowfury": 1,
      },
    });
    expect(admin.length).toBeGreaterThan(0);
    const axe = admin.find((r) => r.canonicalKey === "warlock.interrupt.axe-toss");
    expect(axe?.useCount).toBe(4);
    expect(axe?.dimension).toBe("UTILITY");
    expect(axe?.reportCode).toBe("AbCdEf12");

    const publicRows = buildCooldownUsagePublicRows(admin);
    expect(publicRows.every((r) => !("reportCode" in r))).toBe(true);
    expect(JSON.stringify(publicRows)).not.toContain("AbCdEf12");
  });

  it("fail-closes when class/spec identity is missing", () => {
    expect(
      buildCooldownUsageAdminRows({
        dungeonSlug: "skyreach",
        slotIndex: 0,
        keyLevel: 15,
        reportCode: null,
        fightId: null,
        reportRevision: null,
        classSlug: "warlock",
        specSlug: null,
        catalogVersion: null,
        extractorVersion: null,
        evidenceCoverageState: "UNKNOWN",
        sourceDataset: null,
        useCountsByCanonicalKey: {},
      }),
    ).toEqual([]);
  });
});
