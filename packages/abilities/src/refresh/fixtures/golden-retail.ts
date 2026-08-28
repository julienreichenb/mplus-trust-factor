import { RETAIL_CLASS_MATRIX } from "../../catalog/classes-matrix.js";
import { knownRetailRaceSlugs } from "../topology.js";
import type { BlizzardRefreshSnapshotFile } from "../sources/blizzard.js";
import type { SimcSpellQueryExport } from "../sources/simc.js";

/** Pinned SimC SHA for golden fixtures — not a live clone. */
export const FIXTURE_SIMC_COMMIT_SHA = "b7e3c1a94d2e8f0156a90c4b3d7e21f8a6c5d409";
export const FIXTURE_BLIZZARD_BUILD = "12.0.0.63893";
export const FIXTURE_RETRIEVED_AT = "2026-08-16T12:00:00.000Z";

const matrixSpecs = RETAIL_CLASS_MATRIX.flatMap((c) =>
  c.specs.map((s) => ({
    classSlug: c.slug,
    specSlug: s.slug,
    blizzardSpecId: s.blizzardSpecId,
    name: s.name,
  })),
);

export const GOLDEN_BLIZZARD_SNAPSHOT: BlizzardRefreshSnapshotFile = {
  datasetKind: "FIXTURE",
  sourceVersion: "wow-game-data-spell-identity-2026-08-16",
  wowBuild: FIXTURE_BLIZZARD_BUILD,
  retrievedAt: FIXTURE_RETRIEVED_AT,
  namespace: "static-us",
  locale: "en_US",
  region: "us",
  gameVersion: "12.0.0",
  validFromBuild: FIXTURE_BLIZZARD_BUILD,
  seasonSlug: "midnight-season-1",
  playableClasses: RETAIL_CLASS_MATRIX.map((c) => ({
    slug: c.slug,
    blizzardClassId: c.blizzardClassId,
    name: c.name,
  })),
  playableSpecializations: matrixSpecs,
  playableRaces: knownRetailRaceSlugs().map((slug, i) => ({
    slug,
    blizzardRaceId: i + 1,
    name: slug,
  })),
  spells: [
    {
      spellId: 12472,
      name: "Icy Veins",
      classSlug: "mage",
      notes: ["Spell identity only — not a Frost toolkit membership proof."],
    },
  ],
};

export const GOLDEN_SIMC_SNAPSHOT: SimcSpellQueryExport = {
  schemaVersion: "simc-spellquery-export-v1",
  datasetKind: "FIXTURE",
  simcCommitSha: FIXTURE_SIMC_COMMIT_SHA,
  simcBranch: "midnight",
  extractorVersion: "spellquery-export-0.1.0",
  retrievedAt: FIXTURE_RETRIEVED_AT,
  sourceVersion: "spellquery-export-0.1.0",
  gameVersion: "12.0.0",
  validFromBuild: FIXTURE_BLIZZARD_BUILD,
  inventories: [
    {
      kind: "SPEC",
      classSlug: "mage",
      specSlug: "frost",
      completeness: "COMPLETE",
      queryClaim: "COMPLETE_FOR_QUERY",
      claimsCompleteToolkit: false,
      queryExpression: "spec_spell",
      scopeClassification: "PLAYABLE_SPEC",
    },
    {
      kind: "SPEC",
      classSlug: "priest",
      specSlug: "shadow",
      completeness: "COMPLETE",
      queryClaim: "COMPLETE_FOR_QUERY",
      claimsCompleteToolkit: false,
      queryExpression: "spec_spell",
      scopeClassification: "PLAYABLE_SPEC",
    },
    {
      kind: "SPEC",
      classSlug: "shaman",
      specSlug: "elemental",
      completeness: "COMPLETE",
      queryClaim: "COMPLETE_FOR_QUERY",
      claimsCompleteToolkit: false,
      queryExpression: "spec_spell",
      scopeClassification: "PLAYABLE_SPEC",
    },
    {
      kind: "SPEC",
      classSlug: "shaman",
      specSlug: "enhancement",
      completeness: "PARTIAL",
      queryClaim: "NONE",
      claimsCompleteToolkit: false,
      queryExpression: "spec_spell",
      scopeClassification: "PLAYABLE_SPEC",
    },
    {
      kind: "RACE",
      raceSlug: "dwarf",
      completeness: "COMPLETE",
      queryClaim: "COMPLETE_FOR_QUERY",
      claimsCompleteToolkit: false,
      queryExpression: "race_spell",
      scopeClassification: "PLAYABLE_RACE",
    },
  ],
  spells: [
    {
      spellId: 84714,
      name: "Frozen Orb",
      classSlug: "mage",
      specSlugs: ["frost"],
      cooldownSeconds: 60,
      isPassive: false,
      catalogRelevant: true,
      proposedCanonicalKey: "mage.offensive.frozen-orb",
    },
    {
      spellId: 15286,
      name: "Vampiric Embrace",
      classSlug: "priest",
      specSlugs: ["shadow"],
      cooldownSeconds: 120,
      isPassive: false,
      catalogRelevant: true,
      proposedCanonicalKey: "priest.shadow.vampiric-embrace",
      notes: ["Present in Shadow spec SpellQuery inventory; absent from current canonical catalog."],
    },
    {
      spellId: 191634,
      name: "Stormkeeper",
      classSlug: "shaman",
      specSlugs: ["elemental", "enhancement"],
      cooldownSeconds: 60,
      isPassive: false,
      catalogRelevant: true,
      proposedCanonicalKey: "shaman.offensive.stormkeeper",
      bindings: [
        {
          spellId: 191634,
          role: "PRIMARY_ACTIVATION",
          evidence: "spellquery:activation",
        },
        {
          spellId: 191634,
          role: "STACK_AURA",
          evidence: "spellquery:stack-aura",
        },
        {
          spellId: 383009,
          role: "CAST_ALIAS",
          evidence: "spellquery:enhancement-cast-alias",
        },
        {
          spellId: 191634,
          role: "TRIGGERED_EFFECT",
          evidence: "spellquery:consumption-effect-same-id-distinct-role",
        },
      ],
      notes: [
        "SYNTHETIC_CONTRACT only: typed binding roles for engine tests.",
        "Not REAL_CAPTURE evidence that current Retail Stormkeeper exposes these bindings.",
      ],
    },
    {
      spellId: 20594,
      name: "Stoneform",
      classSlug: null,
      raceSlugs: ["dwarf"],
      cooldownSeconds: 120,
      isPassive: false,
      catalogRelevant: true,
      proposedCanonicalKey: "shared.racial.stoneform",
    },
    {
      spellId: 20596,
      name: "Frost Resistance",
      classSlug: null,
      raceSlugs: ["dwarf"],
      isPassive: true,
      catalogRelevant: false,
      notes: ["Passive racial discovery — not an AbilityRule candidate by default."],
    },
  ],
};
