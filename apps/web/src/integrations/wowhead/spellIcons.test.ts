import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveWowheadSpellIconUrl } from "./spellIcons";

describe("resolveWowheadSpellIconUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a zamimg icon URL from Wowhead tooltip payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(String(url)).toContain("/tooltip/spell/386164");
        expect(String(url)).not.toContain("dataEnv=");
        return {
          ok: true,
          text: async () => `{"name":"Battle Stance","icon":"ability_warrior_offensivestance"}`,
        };
      }),
    );
    await expect(resolveWowheadSpellIconUrl(386164)).resolves.toBe(
      "https://wow.zamimg.com/images/wow/icons/large/ability_warrior_offensivestance.jpg",
    );
  });

  it("returns null for invalid spell ids", async () => {
    await expect(resolveWowheadSpellIconUrl(0)).resolves.toBeNull();
  });
});
