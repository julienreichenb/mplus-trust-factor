/**
 * Fails when active production code retains removed Scoring V1/V2 architecture.
 * Excludes migrations and archived historical docs.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");

const FORBIDDEN = [
  /scoring-v2/i,
  /ScoringV2/,
  /SCORING_V2_/,
  /supersedesCompatibilityKey/,
  /selectCanonicalCompatiblePackageHead/,
  /repairIncompatibleCapabilityPackages/,
  /targeted.?package.?repair/i,
  /from ["']@mplus\/scoring["'].*calculateScore|calculateScore\s*\}?\s*from\s*["']@mplus\/scoring["']/,
];

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "artifacts",
  ".git",
  "archive",
  "migrations",
  "coverage",
]);

const SKIP_PATH_FRAGMENTS = [
  `${path.sep}doc${path.sep}scoring${path.sep}archive${path.sep}`,
  `${path.sep}packages${path.sep}database${path.sep}prisma${path.sep}migrations${path.sep}`,
  `${path.sep}apps${path.sep}worker${path.sep}artifacts${path.sep}`,
];

const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".vue",
  ".js",
  ".mjs",
  ".json",
]);

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (SKIP_PATH_FRAGMENTS.some((frag) => full.includes(frag))) continue;
    if (entry.isDirectory()) {
      await walk(full, out);
      continue;
    }
    const ext = path.extname(entry.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;
    // Hygiene test file itself mentions forbidden tokens.
    if (full.endsWith(`${path.sep}scoring-nomenclature.hygiene.test.ts`)) continue;
    out.push(full);
  }
}

describe("scoring nomenclature hygiene", () => {
  it("active production sources have no V1/V2 or supersession vocabulary", async () => {
    const roots = [
      path.join(ROOT, "apps"),
      path.join(ROOT, "packages"),
      path.join(ROOT, "tools"),
    ];
    const files: string[] = [];
    for (const root of roots) {
      const s = await stat(root).catch(() => null);
      if (s?.isDirectory()) await walk(root, files);
    }

    const violations: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) {
          violations.push(`${path.relative(ROOT, file)} :: ${pattern}`);
          break;
        }
      }
    }

    expect(violations.slice(0, 40)).toEqual([]);
  });
});
