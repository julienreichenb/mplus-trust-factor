import { describe, expect, it } from "vitest";
import { buildExternalMetadata, enrichRuleExternalMetadata } from "./external-metadata.js";
import { rule } from "./catalog/rule.js";
import { WOW_ICON_CDN_BASE } from "./wow-icons.js";

describe("buildExternalMetadata", () => {
  it("normalizes icon names with extensions into CDN URLs", () => {
    const meta = buildExternalMetadata(6552, { iconName: "ability_warrior_shieldbash.jpg" });
    expect(meta.iconName).toBe("ability_warrior_shieldbash");
    expect(meta.iconUrl).toBe(`${WOW_ICON_CDN_BASE}/ability_warrior_shieldbash.jpg`);
    expect(meta.metadataSource).toBe("WOWHEAD");
  });

  it("returns null icon fields when no identifier is provided", () => {
    const meta = buildExternalMetadata(6552);
    expect(meta.iconName).toBeNull();
    expect(meta.iconUrl).toBeNull();
    expect(meta.wowheadUrl).toContain("6552");
    expect(meta.metadataSource).toBe("FALLBACK");
  });
});

describe("enrichRuleExternalMetadata", () => {
  it("uses rule.iconName when present", () => {
    const ability = rule({
      canonicalKey: "warrior.interrupt.pummel",
      name: "Pummel",
      spellIds: [6552],
      iconName: "ability_warrior_shieldbash",
      classSlug: "warrior",
      roles: ["DPS"],
      category: "INTERRUPT",
    });
    const meta = enrichRuleExternalMetadata(ability);
    expect(meta.iconUrl).toContain("ability_warrior_shieldbash.jpg");
  });
});
