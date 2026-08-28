import { RETAIL_CLASS_MATRIX } from "../../catalog/classes-matrix.js";
import { detectNonRetailNamespace, isRetailStaticNamespace } from "../topology.js";
import type {
  ExternalSourceRecord,
  ExternalSourceSnapshot,
  ScopedInventory,
} from "../types.js";

export interface BlizzardGameDataTransport {
  getJson: (input: {
    path: string;
    namespace: string;
    locale: string;
  }) => Promise<unknown>;
}

export interface BlizzardSpellIdentityRecord {
  spellId: number;
  name: string;
  classSlug?: string | null;
  specSlugs?: string[];
  mediaIcon?: string | null;
  notes?: string[];
}

export interface BlizzardRefreshSnapshotFile {
  sourceVersion: string;
  wowBuild: string;
  retrievedAt: string;
  namespace: string;
  locale: string;
  datasetKind?: "FIXTURE" | "PINNED";
  region?: string;
  gameVersion?: string;
  validFromBuild?: string;
  validToBuild?: string;
  seasonSlug?: string;
  playableClasses?: Array<{ slug: string; blizzardClassId: number; name: string }>;
  playableSpecializations?: Array<{
    classSlug: string;
    specSlug: string;
    blizzardSpecId: number;
    name: string;
  }>;
  playableRaces?: Array<{ slug: string; blizzardRaceId: number; name: string }>;
  spells?: BlizzardSpellIdentityRecord[];
}

/**
 * Blizzard Game Data adapter for shadow refresh.
 * Live HTTP is optional and injectable; production runtime never calls this.
 * Spell identity ≠ complete spec toolkit membership.
 */
export function importBlizzardRefreshSnapshot(
  file: BlizzardRefreshSnapshotFile,
): ExternalSourceSnapshot {
  if (!isRetailStaticNamespace(file.namespace)) {
    throw new Error(`Rejected non-Retail Blizzard namespace: ${file.namespace}`);
  }
  const rejected = detectNonRetailNamespace(file.namespace);
  if (rejected) {
    throw new Error(`Rejected non-Retail Blizzard namespace marker: ${rejected}`);
  }

  const inventories: ScopedInventory[] = [];
  const classes = file.playableClasses ?? RETAIL_CLASS_MATRIX.map((c) => ({ slug: c.slug }));
  for (const cls of classes) {
    inventories.push({
      kind: "CLASS",
      classSlug: cls.slug,
      completeness: "COMPLETE",
      queryClaim: "NONE",
      claimsCompleteToolkit: false,
      scopeClassification: "PLAYABLE_CLASS",
    });
  }
  const specs =
    file.playableSpecializations ??
    RETAIL_CLASS_MATRIX.flatMap((c) =>
      c.specs.map((s) => ({ classSlug: c.slug, specSlug: s.slug })),
    );
  for (const spec of specs) {
    inventories.push({
      kind: "SPEC",
      classSlug: spec.classSlug,
      specSlug: spec.specSlug,
      completeness: "UNKNOWN",
      queryClaim: "NONE",
      claimsCompleteToolkit: false,
      scopeClassification: "PLAYABLE_SPEC",
    });
  }
  for (const race of file.playableRaces ?? []) {
    inventories.push({
      kind: "RACE",
      raceSlug: race.slug,
      completeness: "UNKNOWN",
      queryClaim: "NONE",
      claimsCompleteToolkit: false,
      scopeClassification: "PLAYABLE_RACE",
    });
  }
  inventories.push({
    kind: "SPELL_IDENTITY",
    completeness: "PARTIAL",
    queryClaim: "NONE",
    claimsCompleteToolkit: false,
    scopeClassification: "SPELL_IDENTITY",
  });

  const records: ExternalSourceRecord[] = (file.spells ?? []).map((s) => ({
    spellId: s.spellId,
    name: s.name,
    classSlug: s.classSlug ?? null,
    specSlugs: s.specSlugs ?? [],
    catalogRelevant: false,
    notes: [
      "Blizzard confirms spell identity only; this is not a complete spec toolkit proof.",
      ...(s.notes ?? []),
    ],
    extra: s.mediaIcon ? { mediaIcon: s.mediaIcon } : undefined,
  }));

  return {
    identity: {
      source: "BLIZZARD",
      datasetKind: file.datasetKind ?? "PINNED",
      sourceVersion: file.sourceVersion,
      sourceRevision: file.wowBuild,
      retrievedAt: file.retrievedAt,
      validFromBuild: file.validFromBuild ?? file.wowBuild,
      validToBuild: file.validToBuild,
      seasonSlug: file.seasonSlug,
      blizzardNamespace: file.namespace,
      blizzardLocale: file.locale,
      captureProvenance: file.datasetKind === "FIXTURE" ? "SYNTHETIC_CONTRACT" : "REAL_CAPTURE",
    },
    blizzard: {
      namespace: file.namespace,
      locale: file.locale,
      region: file.region,
      gameVersion: file.gameVersion,
      wowBuild: file.wowBuild,
    },
    inventories,
    records,
  };
}

export async function loadBlizzardSnapshotViaTransport(
  transport: BlizzardGameDataTransport,
  input: { namespace: string; locale: string; path: string },
): Promise<unknown> {
  if (!isRetailStaticNamespace(input.namespace)) {
    throw new Error(`Refusing non-Retail namespace ${input.namespace}`);
  }
  return transport.getJson(input);
}

export function createBlizzardRefreshAdapter(options: {
  snapshot: BlizzardRefreshSnapshotFile;
  transport?: BlizzardGameDataTransport;
}): { loadSnapshot: () => ExternalSourceSnapshot } {
  return {
    loadSnapshot: () => {
      void options.transport;
      return importBlizzardRefreshSnapshot(options.snapshot);
    },
  };
}
