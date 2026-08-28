import { isRetailStaticNamespace } from "../topology.js";
import type { BlizzardRefreshSnapshotFile } from "../sources/blizzard.js";
import { normalizeRetailClassSlug } from "../../catalog/classes-matrix.js";
import { normalizeRaceSlug, raceSlugFromBlizzardRaceId } from "../../race.js";

export const BLIZZARD_EXTRACTOR_VERSION = "blizzard-game-data-extract-0.1.0";

export class BlizzardExtractionError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  constructor(code: string, message: string, statusCode?: number) {
    super(message);
    this.name = "BlizzardExtractionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface BlizzardStaticGetResult {
  statusCode: number;
  data: unknown;
}

export type BlizzardStaticGetter = (input: {
  path: string;
  endpointKey: string;
}) => Promise<BlizzardStaticGetResult>;

interface IndexItem {
  id?: number;
  name?: string | { en_US?: string; en_GB?: string };
  slug?: string;
}

function nameOf(value: IndexItem["name"] | undefined): string {
  if (typeof value === "string") return value;
  return value?.en_GB ?? value?.en_US ?? "";
}

function slugFromName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function mapFailure(statusCode: number, endpoint: string): never {
  if (statusCode === 401 || statusCode === 403) {
    throw new BlizzardExtractionError("AUTH_FAILURE", `Blizzard auth failed for ${endpoint}`, statusCode);
  }
  if (statusCode === 404) {
    throw new BlizzardExtractionError("NOT_FOUND", `Blizzard 404 for ${endpoint}`, statusCode);
  }
  if (statusCode === 429) {
    throw new BlizzardExtractionError("RATE_LIMITED", `Blizzard 429 for ${endpoint}`, statusCode);
  }
  if (statusCode >= 500) {
    throw new BlizzardExtractionError("SERVER_ERROR", `Blizzard ${statusCode} for ${endpoint}`, statusCode);
  }
  throw new BlizzardExtractionError("REQUEST_FAILED", `Blizzard ${statusCode} for ${endpoint}`, statusCode);
}

export interface BlizzardExtractInput {
  getter: BlizzardStaticGetter;
  region: string;
  locale: string;
  namespace: string;
  spellIds?: number[];
  retrievedAt?: string;
  wowBuild?: string;
}

export async function extractBlizzardRefreshSnapshot(
  input: BlizzardExtractInput,
): Promise<BlizzardRefreshSnapshotFile> {
  const namespace = input.namespace;
  if (!isRetailStaticNamespace(namespace)) {
    throw new BlizzardExtractionError("NON_RETAIL_NAMESPACE", `Refusing namespace ${namespace}`);
  }

  const classIndex = await input.getter({
    path: "/data/wow/playable-class/index",
    endpointKey: "playable-class.index",
  });
  if (classIndex.statusCode !== 200) mapFailure(classIndex.statusCode, "playable-class.index");
  const specIndex = await input.getter({
    path: "/data/wow/playable-specialization/index",
    endpointKey: "playable-specialization.index",
  });
  if (specIndex.statusCode !== 200) mapFailure(specIndex.statusCode, "playable-specialization.index");
  const raceIndex = await input.getter({
    path: "/data/wow/playable-race/index",
    endpointKey: "playable-race.index",
  });
  if (raceIndex.statusCode !== 200) mapFailure(raceIndex.statusCode, "playable-race.index");

  const classesRaw = (classIndex.data as { classes?: IndexItem[] }).classes ?? [];
  const specsRaw = (specIndex.data as { character_specializations?: IndexItem[] })
    .character_specializations ?? [];
  const racesRaw = (raceIndex.data as { races?: IndexItem[] }).races ?? [];

  const playableClasses = classesRaw
    .map((c) => ({
      slug: normalizeRetailClassSlug(slugFromName(nameOf(c.name))) ?? slugFromName(nameOf(c.name)),
      blizzardClassId: c.id ?? 0,
      name: nameOf(c.name),
    }))
    .filter((c) => c.blizzardClassId > 0)
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const playableSpecializations: BlizzardRefreshSnapshotFile["playableSpecializations"] = [];
  for (const spec of specsRaw) {
    const specId = spec.id;
    if (!specId) continue;
    const detail = await input.getter({
      path: `/data/wow/playable-specialization/${specId}`,
      endpointKey: `playable-specialization.${specId}`,
    });
    if (detail.statusCode !== 200) mapFailure(detail.statusCode, `playable-specialization.${specId}`);
    const body = detail.data as {
      name?: IndexItem["name"];
      playable_class?: { name?: IndexItem["name"]; id?: number };
    };
    const className = nameOf(body.playable_class?.name);
    const classSlug = normalizeRetailClassSlug(slugFromName(className)) ?? slugFromName(className);
    playableSpecializations.push({
      classSlug,
      specSlug: slugFromName(nameOf(body.name)),
      blizzardSpecId: specId,
      name: nameOf(body.name),
    });
  }
  playableSpecializations.sort((a, b) =>
    a.classSlug.localeCompare(b.classSlug) || a.specSlug.localeCompare(b.specSlug),
  );

  const playableRaces = racesRaw
    .map((r) => {
      const id = r.id ?? 0;
      const slug = raceSlugFromBlizzardRaceId(id) ?? normalizeRaceSlug(slugFromName(nameOf(r.name)));
      return {
        slug: slug ?? slugFromName(nameOf(r.name)),
        blizzardRaceId: id,
        name: nameOf(r.name),
      };
    })
    .filter((r) => r.blizzardRaceId > 0)
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const spells: NonNullable<BlizzardRefreshSnapshotFile["spells"]> = [];
  for (const spellId of [...new Set(input.spellIds ?? [])].sort((a, b) => a - b)) {
    let spellRes = await input.getter({
      path: `/data/wow/spell/${spellId}`,
      endpointKey: `spell.${spellId}`,
    });
    for (let attempt = 0; attempt < 3 && spellRes.statusCode === 429; attempt += 1) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      spellRes = await input.getter({
        path: `/data/wow/spell/${spellId}`,
        endpointKey: `spell.${spellId}`,
      });
    }
    if (spellRes.statusCode === 404 || spellRes.statusCode >= 500) continue;
    if (spellRes.statusCode !== 200) mapFailure(spellRes.statusCode, `spell.${spellId}`);
    const body = spellRes.data as { id?: number; name?: IndexItem["name"] };
    spells.push({
      spellId: body.id ?? spellId,
      name: nameOf(body.name) || `Spell ${spellId}`,
      notes: ["Blizzard spell identity only — not a spec toolkit membership proof."],
    });
  }

  return {
    datasetKind: "PINNED",
    sourceVersion: BLIZZARD_EXTRACTOR_VERSION,
    wowBuild: input.wowBuild ?? "unknown-build",
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
    namespace,
    locale: input.locale,
    region: input.region,
    playableClasses,
    playableSpecializations,
    playableRaces,
    spells,
  };
}
