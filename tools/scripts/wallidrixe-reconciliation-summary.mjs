import { createRequire } from "node:module";
import { resolve } from "node:path";

const req = createRequire(resolve("packages/database/package.json"));
const { createPrismaClient } = req("./dist/index.js");
const prisma = createPrismaClient(process.env.DATABASE_URL);

const ACTIVE_SEASON = "blizzard-season-3";
const ACTIVE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const nowMs = Date.now();

const region = await prisma.region.findUnique({ where: { code: "EU" } });
const realm = await prisma.realm.findUnique({
  where: { regionId_slug: { regionId: region.id, slug: "archimonde" } },
});
const character = await prisma.character.findUnique({
  where: {
    regionId_realmId_normalizedName: {
      regionId: region.id,
      realmId: realm.id,
      normalizedName: "wallidrixe",
    },
  },
});

const allRuns = await prisma.mythicRun.findMany({
  where: { participants: { some: { characterId: character.id, isTargetCharacter: true } } },
  include: { sources: true, dungeon: true, season: true },
  orderBy: { completedAt: "desc" },
});

const seasonRuns = allRuns.filter((r) => r.season.slug === ACTIVE_SEASON);
const outsideActiveSeason = allRuns.filter((r) => r.season.slug !== ACTIVE_SEASON);
const outsideActiveWindow = seasonRuns.filter(
  (r) => nowMs - r.completedAt.getTime() > ACTIVE_MAX_AGE_MS,
);

function combo(run) {
  const providers = new Set(run.sources.map((s) => s.provider));
  const has = (p) => providers.has(p);
  const b = has("BLIZZARD");
  const r = has("RAIDER_IO");
  const w = has("WARCRAFT_LOGS");
  if (b && r && w) return "allThree";
  if (b && r) return "blizzardRio";
  if (b && w) return "blizzardWcl";
  if (r && w) return "rioWcl";
  if (b) return "blizzardOnly";
  if (r) return "rioOnly";
  if (w) return "wclOnly";
  return "sourceless";
}

const counts = {
  rioOnly: 0,
  wclOnly: 0,
  blizzardOnly: 0,
  rioWcl: 0,
  blizzardRio: 0,
  blizzardWcl: 0,
  allThree: 0,
  sourceless: 0,
};

const samples = {
  rioWcl: [],
  blizzardRio: [],
  blizzardWcl: [],
  allThree: [],
  sourceless: [],
};

for (const run of seasonRuns) {
  const key = combo(run);
  counts[key] += 1;
  if (samples[key] && samples[key].length < 8) {
    samples[key].push({
      dungeon: run.dungeon.slug,
      keyLevel: run.keyLevel,
      completedAt: run.completedAt.toISOString(),
      durationMs: run.durationMs,
      providers: run.sources.map((s) => s.provider),
      fingerprint: run.canonicalFingerprint.slice(0, 16),
    });
  }
}

const fingerprints = seasonRuns.map((r) => r.canonicalFingerprint);
const dupFp = fingerprints.filter((fp, i) => fingerprints.indexOf(fp) !== i);
const uniqueFp = new Set(fingerprints);

// Unresolved: RIO-only vs WCL-only with same key and (time<=120s OR duration<=15s within 45m)
const MATCH_TIME = 120_000;
const MATCH_DUR = 15_000;
const CLOCK_SKEW = 45 * 60 * 1000;
const DUNGEON_CANONICAL = {
  aa: "algethar-academy",
  "algethar-academy": "algethar-academy",
  mt: "magisters-terrace",
  "magisters-terrace": "magisters-terrace",
  pos: "priory-of-the-sacred-flame",
  "priory-of-the-sacred-flame": "priory-of-the-sacred-flame",
  mc: "motherlode",
  motherlode: "motherlode",
  nx: "nexus-point-xenas",
  npx: "nexus-point-xenas",
  "nexus-point-xenas": "nexus-point-xenas",
  sot: "seat-of-the-triumvirate",
  seat: "seat-of-the-triumvirate",
  "seat-of-the-triumvirate": "seat-of-the-triumvirate",
  sr: "skyreach",
  skyreach: "skyreach",
};
const canon = (s) => DUNGEON_CANONICAL[(s || "").toLowerCase()] ?? (s || "").toLowerCase();
const isUnknown = (s) => !s || !s.trim() || s.toLowerCase() === "unknown";

const rioSide = seasonRuns.filter((r) => {
  const p = new Set(r.sources.map((s) => s.provider));
  return p.has("RAIDER_IO") && !p.has("WARCRAFT_LOGS");
});
const wclSide = seasonRuns.filter((r) => {
  const p = new Set(r.sources.map((s) => s.provider));
  return p.has("WARCRAFT_LOGS") && !p.has("RAIDER_IO") && !p.has("BLIZZARD");
});

const unresolved = [];
const usedWcl = new Set();
for (const rio of rioSide) {
  for (const wcl of wclSide) {
    if (usedWcl.has(wcl.id)) continue;
    if (rio.keyLevel !== wcl.keyLevel) continue;
    // True cross-provider candidate: both have known dungeons that canonicalize equal.
    if (isUnknown(rio.dungeon.slug) || isUnknown(wcl.dungeon.slug)) continue;
    if (canon(rio.dungeon.slug) !== canon(wcl.dungeon.slug)) continue;

    const timeDelta = Math.abs(rio.completedAt.getTime() - wcl.completedAt.getTime());
    const durDelta =
      rio.durationMs > 0 && wcl.durationMs > 0
        ? Math.abs(rio.durationMs - wcl.durationMs)
        : null;
    const timeMatch = timeDelta <= MATCH_TIME;
    const durMatch = durDelta != null && durDelta <= MATCH_DUR;
    const wouldPersist = timeMatch || (durMatch && timeDelta <= CLOCK_SKEW);
    if (wouldPersist) continue;

    unresolved.push({
      reason: "same_dungeon_and_key_but_outside_time_or_duration_window",
      explanation:
        "Dungeon+key align across RIO and WCL, but completion delta exceeds 120s and duration delta exceeds 15s (or clock-skew cap). Treated as distinct Mythic+ runs.",
      rio: {
        dungeon: rio.dungeon.slug,
        key: rio.keyLevel,
        completedAt: rio.completedAt.toISOString(),
        durationMs: rio.durationMs,
      },
      wcl: {
        dungeon: wcl.dungeon.slug,
        key: wcl.keyLevel,
        completedAt: wcl.completedAt.toISOString(),
        durationMs: wcl.durationMs,
      },
      timeDeltaMs: timeDelta,
      durationDeltaMs: durDelta,
    });
    usedWcl.add(wcl.id);
  }
}

const providerState = await prisma.characterProviderState.findUnique({
  where: { characterId_provider: { characterId: character.id, provider: "WARCRAFT_LOGS" } },
});

console.log(
  JSON.stringify(
    {
      character: "EU/archimonde/Wallidrixe",
      activeSeason: ACTIVE_SEASON,
      totalUniqueCanonicalRuns: uniqueFp.size,
      seasonRunRows: seasonRuns.length,
      rowsBySourceCombination: counts,
      samples,
      sourcelessRows: counts.sourceless,
      rowsOutsideActiveSeason: outsideActiveSeason.length,
      rowsOutsideActiveSeasonSlugs: [...new Set(outsideActiveSeason.map((r) => r.season.slug))],
      rowsOutsideActiveWindowInSeason: outsideActiveWindow.length,
      duplicateCanonicalFingerprints: [...new Set(dupFp)].length,
      unresolvedTrueCrossProviderMatches: unresolved,
      providerMetadata: providerState?.metadata ?? null,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
