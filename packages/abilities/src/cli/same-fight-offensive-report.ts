/**
 * Same-fight offensive validation report for 1WKcCz2BnAQmbhfq:1:r1.
 *
 * Builds digests from an in-memory evidence bundle that mirrors the spike fight
 * party composition (Warlock / Evoker / Monk / Druid / Death Knight). When
 * Postgres persisted evidence is available, prefer
 * `pnpm wcl:probe:offensive-one-fight` (localOnly) — this CLI never issues live
 * WCL requests.
 *
 * Usage:
 *   pnpm --filter @mplus/abilities exec tsx src/cli/same-fight-offensive-report.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_CATALOG_VERSION_ID,
  dimensionTagsForRule,
  getAllRegisteredRules,
  projectOffensiveActivations,
} from "../index.js";

const FIGHT = {
  reportCode: "1WKcCz2BnAQmbhfq",
  fightId: 1,
  reportRevision: 1,
} as const;

/** Synthetic retained-timeline rows mirroring catalog enrichment for the spike party. */
const PARTICIPANTS = [
  {
    name: "Wallidrixe",
    classSlug: "warlock",
    specSlug: "demonology",
    events: [
      { eventId: "w1", timestampMs: 1000, eventType: "begincast", spellId: 265187, key: "warlock.offensive.demonic-tyrant" },
      { eventId: "w2", timestampMs: 1200, eventType: "cast", spellId: 265187, key: "warlock.offensive.demonic-tyrant" },
      { eventId: "w3", timestampMs: 5000, eventType: "cast", spellId: 111898, key: "warlock.offensive.grimoire-felguard" },
    ],
  },
  {
    name: "Evoker",
    classSlug: "evoker",
    specSlug: "devastation",
    events: [
      { eventId: "e1", timestampMs: 2000, eventType: "cast", spellId: 375087, key: "evoker.offensive.dragonrage" },
      { eventId: "e2", timestampMs: 2100, eventType: "applybuff", spellId: 375087, key: "evoker.offensive.dragonrage" },
    ],
  },
  {
    name: "Monk",
    classSlug: "monk",
    specSlug: "windwalker",
    events: [
      { eventId: "m1", timestampMs: 3000, eventType: "cast", spellId: 137639, key: "monk.offensive.storm-earth-and-fire" },
      { eventId: "m2", timestampMs: 4000, eventType: "refreshbuff", spellId: 137639, key: "monk.offensive.storm-earth-and-fire" },
    ],
  },
  {
    name: "Druid",
    classSlug: "druid",
    specSlug: "balance",
    events: [
      { eventId: "d1", timestampMs: 3500, eventType: "cast", spellId: 194223, key: "druid.offensive.celestial-alignment" },
    ],
  },
  {
    name: "DeathKnight",
    classSlug: "death-knight",
    specSlug: "frost",
    events: [
      { eventId: "k1", timestampMs: 4500, eventType: "cast", spellId: 51271, key: "death-knight.offensive.pillar-of-frost" },
      { eventId: "k2", timestampMs: 4550, eventType: "applybuff", spellId: 51271, key: "death-knight.offensive.pillar-of-frost" },
    ],
  },
] as const;

const rules = getAllRegisteredRules();
const offensiveByClassSpec = (classSlug: string, specSlug: string) =>
  rules.filter(
    (r) =>
      dimensionTagsForRule(r).includes("PERFORMANCE_OFFENSIVE_COOLDOWN") &&
      r.classSlug === classSlug &&
      (r.specSlugs.length === 0 || r.specSlugs.includes(specSlug)),
  );

const participants = PARTICIPANTS.map((p, idx) => {
  const catalogEntries = offensiveByClassSpec(p.classSlug, p.specSlug);
  const projection = projectOffensiveActivations({
    events: p.events.map((e) => ({
      eventId: e.eventId,
      timestampMs: e.timestampMs,
      eventType: e.eventType,
      spellId: e.spellId,
      canonicalKey: e.key,
      sourceOwnerPlayerActorId: idx + 1,
      sourceActorId: idx + 1,
    })),
  });
  const retained = Object.entries(projection.byCanonicalKey).map(([canonicalKey, count]) => {
    const rule = rules.find((r) => r.canonicalKey === canonicalKey);
    return {
      canonicalKey,
      canonicalName: rule?.name ?? null,
      spellIds: rule?.spellIds ?? [],
      activationCount: count,
    };
  });

  let coverageStatus:
    | "CATALOG_HAS_NO_ENTRIES"
    | "ENTRIES_EXIST_UNUSED"
    | "ACTIVATIONS_OBSERVED"
    | "EVIDENCE_INCOMPLETE";
  if (catalogEntries.length === 0) coverageStatus = "CATALOG_HAS_NO_ENTRIES";
  else if (projection.deduplicatedActivationCount === 0) coverageStatus = "ENTRIES_EXIST_UNUSED";
  else coverageStatus = "ACTIVATIONS_OBSERVED";

  return {
    characterName: p.name,
    classSlug: p.classSlug,
    specSlug: p.specSlug,
    reviewedCatalogEntryCount: catalogEntries.length,
    rawRetainedEventCount: projection.rawRetainedEventCount,
    deduplicatedActivationCount: projection.deduplicatedActivationCount,
    canonicalCooldownCount: projection.canonicalCooldownCount,
    retainedCanonicalAbilities: retained,
    coverageStatus,
    note:
      "Synthetic timeline for catalog enrichment proof. Prefer persisted evidence via wcl:probe:offensive-one-fight when DATABASE_URL is configured.",
  };
});

const report = {
  schemaVersion: "same-fight-offensive-validation-v1",
  fight: FIGHT,
  abilityCatalogVersion: CURRENT_CATALOG_VERSION_ID,
  providerCallsDuringReload: 0,
  fillersExcludedProof: {
    shadowBoltSpellId: 686,
    azureStrikeSpellId: 362969,
    note: "Fillers are not in PERFORMANCE_OFFENSIVE_COOLDOWN catalog; digest tests assert unmatched/ignored.",
  },
  participants,
  generatedAt: "2026-08-05T12:00:00.000Z",
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../../generated/offensive");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "same-fight-validation-report.json");
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Same-fight offensive validation (synthetic spike party)`);
console.log(`  fight: ${FIGHT.reportCode}:${FIGHT.fightId}:r${FIGHT.reportRevision}`);
console.log(`  providerCallsDuringReload: 0`);
for (const p of participants) {
  console.log(
    `  ${p.characterName} (${p.classSlug}/${p.specSlug}): raw=${p.rawRetainedEventCount} activations=${p.deduplicatedActivationCount} cooldowns=${p.canonicalCooldownCount} catalog=${p.reviewedCatalogEntryCount} status=${p.coverageStatus}`,
  );
}
console.log(`Wrote ${outPath}`);
