import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapStatusToError } from "./errors.js";

export interface FixtureManifest {
  characters: Record<
    string,
    {
      profile: string;
      equipment: string;
      specializations: string;
      media: string;
      mythicIndex: string;
      mythicSeason: string;
    }
  >;
  realms: Record<string, string>;
  seasons: {
    index: string;
    byId: Record<string, string>;
  };
  periods: {
    index: string;
    byId: Record<string, string>;
  };
  dungeons: {
    index: string;
    byId: Record<string, string>;
  };
  items: Record<string, { item: string; media: string }>;
  errors: Record<string, string>;
}

const DEFAULT_FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../tools/fixtures/blizzard",
);

export class FixtureStore {
  readonly dir: string;
  readonly manifest: FixtureManifest;

  constructor(fixtureDir?: string) {
    this.dir = fixtureDir ?? DEFAULT_FIXTURE_DIR;
    if (!existsSync(this.dir)) {
      throw mapStatusToError({
        statusCode: null,
        message: `Blizzard fixture directory missing: ${this.dir}`,
        reason: "CONFIGURATION_ERROR",
      });
    }
    this.manifest = this.readJson<FixtureManifest>("manifest.json");
  }

  characterKey(region: string, realmSlug: string, name: string): string {
    return `${region.toUpperCase()}:${realmSlug.toLowerCase()}:${name.toLocaleLowerCase("en-US")}`;
  }

  readJson<T>(relativePath: string): T {
    const full = path.join(this.dir, relativePath);
    if (!existsSync(full)) {
      throw mapStatusToError({
        statusCode: null,
        message: `Blizzard fixture missing: ${relativePath}`,
        reason: "CONFIGURATION_ERROR",
      });
    }
    return JSON.parse(readFileSync(full, "utf8")) as T;
  }

  getCharacterBundle(region: string, realmSlug: string, name: string) {
    const key = this.characterKey(region, realmSlug, name);
    const entry = this.manifest.characters[key];
    if (!entry) {
      const notFound = this.readJson<unknown>(this.manifest.errors["404"] ?? "errors/404.json");
      throw mapStatusToError({
        statusCode: 404,
        message: `Character not found in fixtures: ${key}`,
        reason: "NOT_FOUND",
        details: { body: notFound },
      });
    }
    return {
      profile: this.readJson(entry.profile),
      equipment: this.readJson(entry.equipment),
      specializations: this.readJson(entry.specializations),
      media: this.readJson(entry.media),
      mythicIndex: this.readJson(entry.mythicIndex),
      mythicSeason: this.readJson(entry.mythicSeason),
    };
  }
}
