import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("ability catalog replay provider isolation", () => {
  it("replay modules do not import live provider clients", () => {
    const files = [
      "ability-catalog-replay-engine.ts",
      "ability-catalog-replay-corpus.ts",
      "ability-catalog-replay-service.ts",
      "ability-catalog-replay-types.ts",
    ];
    const forbidden = [
      "warcraftlogs",
      "blizzard",
      "raider.io",
      "raiderio",
      "simc",
      "wowhead",
      "@mplus/providers",
    ];
    for (const file of files) {
      const src = readFileSync(join(here, file), "utf8").toLowerCase();
      for (const needle of forbidden) {
        expect(src.includes(needle), `${file} must not reference ${needle}`).toBe(false);
      }
    }
  });

  it("derive module imports digest-build only (no live WCL client)", () => {
    const src = readFileSync(join(here, "ability-catalog-replay-derive.ts"), "utf8");
    expect(src).toContain("@mplus/provider-warcraftlogs/digest-build");
    expect(src).not.toMatch(/from ["']@mplus\/provider-warcraftlogs["']/);
    expect(src.toLowerCase()).not.toContain("fetch(");
    expect(src.toLowerCase()).not.toContain("graphql");
    expect(src.toLowerCase()).not.toMatch(/\bhttps?:\/\//);
  });
});
