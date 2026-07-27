import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName } from "@mplus/domain";
import type { RegionCode } from "@mplus/contracts";
import { computeDatasetChecksum } from "./checksum.js";
import { FORMAT_VERSION, LOOKUP_TEST_VECTORS, SHARD_SCHEME } from "./constants.js";
import { filterEligible } from "./eligibility.js";
import { buildLookupKey, shardRelativePath } from "./identity.js";
import { renderMetaTable, renderShardTable, renderTestVectors } from "./lua.js";
import { toCompactRecord } from "./record.js";
import type {
  AddonCompactRecord,
  AddonExportContext,
  AddonExportEligibilityConfig,
  AddonExportInput,
  AddonExportMeta,
  AddonExportResult,
} from "./types.js";
import { DEFAULT_ELIGIBILITY } from "./types.js";

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(TOOL_ROOT, "../..");
const DEFAULT_ADDON_DIR = join(REPO_ROOT, "addon/MPlusTrust");
const DEFAULT_FIXTURE_PATH = join(TOOL_ROOT, "fixtures/score-snapshots.json");

export interface ExportOptions {
  addonDir?: string;
  fixturePath?: string;
  generatedAt?: string;
  eligibility?: Partial<AddonExportEligibilityConfig>;
  context?: Partial<AddonExportContext>;
  records?: AddonExportInput[];
}

export interface FixtureFile {
  context: AddonExportContext;
  records: AddonExportInput[];
}

export function loadFixtureFile(fixturePath: string = DEFAULT_FIXTURE_PATH): FixtureFile {
  const raw = readFileSync(fixturePath, "utf8");
  return JSON.parse(raw) as FixtureFile;
}

export function buildExportResult(
  records: AddonExportInput[],
  context: AddonExportContext,
  eligibility: AddonExportEligibilityConfig = DEFAULT_ELIGIBILITY,
): AddonExportResult {
  const eligible = filterEligible(records, eligibility);
  const shards = new Map<string, Map<string, AddonCompactRecord>>();

  for (const input of eligible) {
    const lookupKey = buildLookupKey(input.region, input.realmSlug, input.name);
    const shardPath = shardRelativePath(input.region, input.realmSlug, normalizeName(input.name));
    let shard = shards.get(shardPath);
    if (!shard) {
      shard = new Map();
      shards.set(shardPath, shard);
    }
    shard.set(lookupKey, toCompactRecord(input, context.generatedAt));
  }

  const checksum = computeDatasetChecksum(shards);
  const meta: AddonExportMeta = {
    ...context,
    formatVersion: context.formatVersion ?? FORMAT_VERSION,
    characterCount: eligible.length,
    checksum,
    shardScheme: SHARD_SCHEME,
  };

  return {
    meta,
    shards,
    shardFiles: [...shards.keys()].sort(),
  };
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeFileEnsured(path: string, content: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, content, "utf8");
}

export function writeExportToAddon(
  result: AddonExportResult,
  addonDir: string = DEFAULT_ADDON_DIR,
): { writtenFiles: string[]; tocDataFiles: string[] } {
  const dataDir = join(addonDir, "Data");
  const writtenFiles: string[] = [];

  const metaPath = join(dataDir, "meta.lua");
  writeFileEnsured(
    metaPath,
    renderMetaTable({
      formatVersion: result.meta.formatVersion,
      generatedAt: result.meta.generatedAt,
      region: result.meta.region,
      season: result.meta.seasonSlug,
      scoreModelKey: result.meta.scoreModelKey,
      scoreModelVersion: result.meta.scoreModelVersion,
      characterCount: result.meta.characterCount,
      checksum: result.meta.checksum,
      shardScheme: result.meta.shardScheme,
    }),
  );
  writtenFiles.push(metaPath);

  for (const shardPath of result.shardFiles) {
    const entries = result.shards.get(shardPath);
    if (!entries) continue;
    const fullPath = join(dataDir, "shards", `${shardPath}.lua`);
    writeFileEnsured(fullPath, renderShardTable(shardPath, entries));
    writtenFiles.push(fullPath);
  }

  const testVectors = LOOKUP_TEST_VECTORS.map((vector) => ({
    key: vector.expectedKey,
    record: toCompactRecord(
      {
        region: vector.region as RegionCode,
        realmSlug: vector.realmSlug,
        name: vector.name,
        overallScore: vector.score,
        grade: vector.grade,
        confidence: vector.confidence,
        calculatedAt: result.meta.generatedAt,
        runCount: 25,
        baselineDungeonComplete: true,
        top25Percent: false,
        stale: false,
        redFlagKeys: [...vector.redFlagKeys],
      },
      result.meta.generatedAt,
    ),
  }));
  const vectorsPath = join(dataDir, "test_vectors.lua");
  writeFileEnsured(vectorsPath, renderTestVectors(testVectors));
  writtenFiles.push(vectorsPath);

  const tocDataFiles = [
    "Data/meta.lua",
    "Data/test_vectors.lua",
    ...result.shardFiles.map((shard) => `Data/shards/${shard.replace(/\\/g, "/")}.lua`),
  ];
  updateTocDataFiles(addonDir, tocDataFiles);

  return { writtenFiles, tocDataFiles };
}

export function updateTocDataFiles(addonDir: string, dataFiles: string[]): void {
  const tocPath = join(addonDir, "MPlusTrust.toc");
  if (!existsSync(tocPath)) {
    throw new Error(`Missing addon TOC at ${tocPath}`);
  }
  const toc = readFileSync(tocPath, "utf8");
  const beginMarker = "## Data files (generated by addon-exporter)";
  const endMarker = "## End generated data files";
  const normalized = dataFiles.map((f) => f.replace(/\\/g, "/")).sort();
  const block = [beginMarker, ...normalized, endMarker].join("\n");

  let next: string;
  if (toc.includes(beginMarker) && toc.includes(endMarker)) {
    const start = toc.indexOf(beginMarker);
    const end = toc.indexOf(endMarker) + endMarker.length;
    next = `${toc.slice(0, start)}${block}${toc.slice(end)}`;
  } else {
    next = `${toc.trimEnd()}\n\n${block}\n`;
  }
  writeFileSync(tocPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
}

export function runExport(options: ExportOptions = {}): AddonExportResult {
  const fixturePath = options.fixturePath ?? DEFAULT_FIXTURE_PATH;
  const fixture = options.records
    ? { context: options.context as AddonExportContext, records: options.records }
    : loadFixtureFile(fixturePath);

  const context: AddonExportContext = {
    formatVersion: FORMAT_VERSION,
    generatedAt: options.generatedAt ?? fixture.context.generatedAt,
    region: (options.context?.region ?? fixture.context.region) as RegionCode,
    seasonSlug: options.context?.seasonSlug ?? fixture.context.seasonSlug,
    scoreModelKey: options.context?.scoreModelKey ?? fixture.context.scoreModelKey,
    scoreModelVersion: options.context?.scoreModelVersion ?? fixture.context.scoreModelVersion,
  };

  const eligibility: AddonExportEligibilityConfig = {
    ...DEFAULT_ELIGIBILITY,
    ...options.eligibility,
  };

  const result = buildExportResult(fixture.records, context, eligibility);
  const addonDir = options.addonDir ?? DEFAULT_ADDON_DIR;
  writeExportToAddon(result, addonDir);
  return result;
}

export function getDefaultPaths(): { repoRoot: string; addonDir: string; fixturePath: string } {
  return {
    repoRoot: REPO_ROOT,
    addonDir: DEFAULT_ADDON_DIR,
    fixturePath: DEFAULT_FIXTURE_PATH,
  };
}

export function relativeFromRepo(path: string): string {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}
