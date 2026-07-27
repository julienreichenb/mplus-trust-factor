import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const manifestSchema = z.object({
  version: z.number(),
  updatedAt: z.string(),
  fixtures: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      schemaVersion: z.string(),
      path: z.string(),
      origin: z.enum(["synthetic", "sanitized-public", "captured"]),
      capturedAt: z.string(),
      description: z.string(),
    }),
  ),
});

export type FixtureManifest = z.infer<typeof manifestSchema>;

let fixturesRoot: string | null = null;

export function getFixturesRoot(): string {
  if (fixturesRoot) return fixturesRoot;
  const here = dirname(fileURLToPath(import.meta.url));
  fixturesRoot = resolve(here, "../../../tools/fixtures");
  return fixturesRoot;
}

export function setFixturesRoot(path: string): void {
  fixturesRoot = path;
}

export function loadFixtureManifest(): FixtureManifest {
  const path = join(getFixturesRoot(), "manifest.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return manifestSchema.parse(raw);
}

export function loadFixtureJson<T>(relativePath: string): T {
  const fullPath = join(getFixturesRoot(), relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Fixture not found: ${fullPath}`);
  }
  return JSON.parse(readFileSync(fullPath, "utf8")) as T;
}

export function loadFixtureById<T>(id: string): { entry: FixtureManifest["fixtures"][number]; data: T } {
  const manifest = loadFixtureManifest();
  const entry = manifest.fixtures.find((f) => f.id === id);
  if (!entry) {
    throw new Error(`Fixture id not found in manifest: ${id}`);
  }
  return { entry, data: loadFixtureJson<T>(entry.path) };
}

const forbiddenPatterns = [
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /\bclient_secret\b/i,
  /\bpassword\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
];

/** Ensures fixture JSON text does not contain obvious secrets or PII. */
export function assertFixtureSanitized(relativePath: string): void {
  const fullPath = join(getFixturesRoot(), relativePath);
  const text = readFileSync(fullPath, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text)) {
      throw new Error(`Fixture ${relativePath} may contain unsanitized data (matched ${pattern})`);
    }
  }
}
