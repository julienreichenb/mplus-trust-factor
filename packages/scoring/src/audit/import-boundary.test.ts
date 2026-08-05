/**
 * Architectural import-boundary: scoring audit/replay must not pull provider clients.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { replayScoringV2Dimensions } from "./replay.js";

const here = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN = [
  "@mplus/provider-warcraftlogs",
  "@mplus/provider-blizzard",
  "@mplus/provider-raiderio",
  "warcraftlogs/src/live",
  "providers/blizzard",
  "providers/raiderio",
];

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkTsFiles(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("scoring audit import boundary", () => {
  it("audit/replay packages do not import WCL/Blizzard/Raider.IO provider clients", () => {
    const files = walkTsFiles(here);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const needle of FORBIDDEN) {
        if (src.includes(needle)) {
          violations.push(`${file} → ${needle}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("exposes provider-free replay entrypoint", () => {
    expect(typeof replayScoringV2Dimensions).toBe("function");
  });
});
