import type { AbilityRole, RetailClassDefinition } from "../types.js";

/**
 * Canonical Retail playable class/spec matrix for Midnight.
 *
 * Authoritative Blizzard Game Data playable-class / specialization indexes
 * (curated snapshot consumed by the Blizzard source adapter).
 *
 * Provenance: Blizzard Game Data playable class + specialization indexes,
 * verified 2026-07-28 / re-validated 2026-08-05 against Midnight live roster
 * (13 classes, 40 specs including Devourer = specialization id 1480).
 *
 * Do not hardcode class/spec counts elsewhere — consume this matrix.
 */
export const RETAIL_CLASS_MATRIX: RetailClassDefinition[] = [
  {
    slug: "death-knight",
    name: "Death Knight",
    blizzardClassId: 6,
    supportState: "SUPPORTED",
    specs: [
      { slug: "blood", name: "Blood", role: "TANK", blizzardSpecId: 250, supportState: "SUPPORTED" },
      { slug: "frost", name: "Frost", role: "DPS", blizzardSpecId: 251, supportState: "SUPPORTED" },
      { slug: "unholy", name: "Unholy", role: "DPS", blizzardSpecId: 252, supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "demon-hunter",
    name: "Demon Hunter",
    blizzardClassId: 12,
    supportState: "PARTIAL",
    notes: "Devourer is Midnight-new; class utilities supported, Devourer-specific toolkit marked uncertain until spell IDs are re-verified against live combatants.",
    specs: [
      { slug: "havoc", name: "Havoc", role: "DPS", blizzardSpecId: 577, supportState: "SUPPORTED" },
      { slug: "vengeance", name: "Vengeance", role: "TANK", blizzardSpecId: 581, supportState: "SUPPORTED" },
      {
        slug: "devourer",
        name: "Devourer",
        role: "DPS",
        blizzardSpecId: 1480,
        supportState: "UNCERTAIN",
        notes: "Midnight specialization id 1480 — covered by reviewed offensive entries (Void Metamorphosis + class-shared The Hunt).",
      },
    ],
  },
  {
    slug: "druid",
    name: "Druid",
    blizzardClassId: 11,
    supportState: "SUPPORTED",
    specs: [
      { slug: "balance", name: "Balance", role: "DPS", blizzardSpecId: 102, supportState: "SUPPORTED" },
      { slug: "feral", name: "Feral", role: "DPS", blizzardSpecId: 103, supportState: "SUPPORTED" },
      { slug: "guardian", name: "Guardian", role: "TANK", blizzardSpecId: 104, supportState: "SUPPORTED" },
      { slug: "restoration", name: "Restoration", role: "HEALER", blizzardSpecId: 105, supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "evoker",
    name: "Evoker",
    blizzardClassId: 13,
    supportState: "SUPPORTED",
    specs: [
      { slug: "devastation", name: "Devastation", role: "DPS", blizzardSpecId: 1467, supportState: "SUPPORTED" },
      { slug: "preservation", name: "Preservation", role: "HEALER", blizzardSpecId: 1468, supportState: "SUPPORTED" },
      { slug: "augmentation", name: "Augmentation", role: "DPS", blizzardSpecId: 1473, supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "hunter",
    name: "Hunter",
    blizzardClassId: 3,
    supportState: "SUPPORTED",
    specs: [
      { slug: "beast-mastery", name: "Beast Mastery", role: "DPS", blizzardSpecId: 253, supportState: "SUPPORTED" },
      { slug: "marksmanship", name: "Marksmanship", role: "DPS", blizzardSpecId: 254, supportState: "SUPPORTED" },
      { slug: "survival", name: "Survival", role: "DPS", blizzardSpecId: 255, supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "mage",
    name: "Mage",
    blizzardClassId: 8,
    supportState: "SUPPORTED",
    specs: [
      { slug: "arcane", name: "Arcane", role: "DPS", blizzardSpecId: 62, supportState: "SUPPORTED" },
      { slug: "fire", name: "Fire", role: "DPS", blizzardSpecId: 63, supportState: "SUPPORTED" },
      { slug: "frost", name: "Frost", role: "DPS", blizzardSpecId: 64, supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "monk",
    name: "Monk",
    blizzardClassId: 10,
    supportState: "SUPPORTED",
    specs: [
      { slug: "brewmaster", name: "Brewmaster", role: "TANK", blizzardSpecId: 268, supportState: "SUPPORTED" },
      { slug: "mistweaver", name: "Mistweaver", role: "HEALER", blizzardSpecId: 270, supportState: "SUPPORTED" },
      { slug: "windwalker", name: "Windwalker", role: "DPS", blizzardSpecId: 269, supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "paladin",
    name: "Paladin",
    blizzardClassId: 2,
    supportState: "SUPPORTED",
    specs: [
      { slug: "holy", name: "Holy", role: "HEALER", blizzardSpecId: 65, supportState: "SUPPORTED" },
      { slug: "protection", name: "Protection", role: "TANK", blizzardSpecId: 66, supportState: "SUPPORTED" },
      { slug: "retribution", name: "Retribution", role: "DPS", blizzardSpecId: 70, supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "priest",
    name: "Priest",
    blizzardClassId: 5,
    supportState: "SUPPORTED",
    specs: [
      { slug: "discipline", name: "Discipline", role: "HEALER", blizzardSpecId: 256, supportState: "SUPPORTED" },
      { slug: "holy", name: "Holy", role: "HEALER", blizzardSpecId: 257, supportState: "SUPPORTED" },
      { slug: "shadow", name: "Shadow", role: "DPS", blizzardSpecId: 258, supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "rogue",
    name: "Rogue",
    blizzardClassId: 4,
    supportState: "SUPPORTED",
    specs: [
      { slug: "assassination", name: "Assassination", role: "DPS", blizzardSpecId: 259, supportState: "SUPPORTED" },
      { slug: "outlaw", name: "Outlaw", role: "DPS", blizzardSpecId: 260, supportState: "SUPPORTED" },
      { slug: "subtlety", name: "Subtlety", role: "DPS", blizzardSpecId: 261, supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "shaman",
    name: "Shaman",
    blizzardClassId: 7,
    supportState: "SUPPORTED",
    specs: [
      { slug: "elemental", name: "Elemental", role: "DPS", blizzardSpecId: 262, supportState: "SUPPORTED" },
      { slug: "enhancement", name: "Enhancement", role: "DPS", blizzardSpecId: 263, supportState: "SUPPORTED" },
      { slug: "restoration", name: "Restoration", role: "HEALER", blizzardSpecId: 264, supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "warlock",
    name: "Warlock",
    blizzardClassId: 9,
    supportState: "SUPPORTED",
    specs: [
      { slug: "affliction", name: "Affliction", role: "DPS", blizzardSpecId: 265, supportState: "SUPPORTED" },
      { slug: "demonology", name: "Demonology", role: "DPS", blizzardSpecId: 266, supportState: "SUPPORTED" },
      { slug: "destruction", name: "Destruction", role: "DPS", blizzardSpecId: 267, supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "warrior",
    name: "Warrior",
    blizzardClassId: 1,
    supportState: "SUPPORTED",
    specs: [
      { slug: "arms", name: "Arms", role: "DPS", blizzardSpecId: 71, supportState: "SUPPORTED" },
      { slug: "fury", name: "Fury", role: "DPS", blizzardSpecId: 72, supportState: "SUPPORTED" },
      { slug: "protection", name: "Protection", role: "TANK", blizzardSpecId: 73, supportState: "SUPPORTED" },
    ],
  },
];

/** Classes observed in the spike fight party 1WKcCz2BnAQmbhfq:1:r1 (not the coverage universe). */
export const SAME_FIGHT_PARTY_CLASS_SLUGS = [
  "warlock",
  "evoker",
  "monk",
  "druid",
  "death-knight",
] as const;

export function findClassDefinition(classSlug: string): RetailClassDefinition | undefined {
  return RETAIL_CLASS_MATRIX.find((c) => c.slug === classSlug);
}

export function findSpecDefinition(classSlug: string, specSlug: string) {
  const cls = findClassDefinition(classSlug);
  if (!cls) return undefined;
  return cls.specs.find((s) => s.slug === specSlug);
}

/**
 * Normalize provider / digest class slugs to the canonical retail matrix form.
 * WCL digests often emit `deathknight` / `demonhunter` without hyphens.
 */
export function normalizeRetailClassSlug(value: string | null | undefined): string | null {
  if (value == null) return null;
  const slug = value.trim().toLowerCase();
  if (!slug) return null;
  if (slug === "deathknight") return "death-knight";
  if (slug === "demonhunter") return "demon-hunter";
  return slug;
}

export interface RetailSpecIdentity {
  classSlug: string;
  specSlug: string;
  role: AbilityRole;
  blizzardSpecId: number;
  blizzardClassId: number;
}

/** Resolve canonical class/spec/role from a Blizzard specialization id (CombatantInfo.specID). */
export function findRetailSpecIdentityByBlizzardSpecId(
  blizzardSpecId: number,
): RetailSpecIdentity | null {
  if (!Number.isFinite(blizzardSpecId) || blizzardSpecId <= 0) return null;
  for (const cls of RETAIL_CLASS_MATRIX) {
    for (const spec of cls.specs) {
      if (spec.blizzardSpecId === blizzardSpecId) {
        return {
          classSlug: cls.slug,
          specSlug: spec.slug,
          role: spec.role,
          blizzardSpecId: spec.blizzardSpecId,
          blizzardClassId: cls.blizzardClassId,
        };
      }
    }
  }
  return null;
}

/**
 * Authoritative playable role for a canonical class + specialization pair.
 *
 * Source of truth: RETAIL_CLASS_MATRIX (version-controlled static catalog).
 * Returns null when the class/spec is unknown — callers must fail closed
 * and must not fabricate DPS / provider-supplied roles.
 */
export function canonicalRoleForClassSpec(
  classSlug: string,
  specSlug: string,
): AbilityRole | null {
  const spec = findSpecDefinition(classSlug, specSlug);
  return spec?.role ?? null;
}

/**
 * Infer the canonical role slug ("DPS", "HEALER", "TANK") from a spec slug alone,
 * searching across all classes. Returns the lowercase role or null when unknown.
 *
 * Used as fallback when WCL's zoneRankings does not return a role field.
 * Prefer {@link canonicalRoleForClassSpec} when class identity is known.
 */
export function roleForSpec(specSlug: string): string | null {
  for (const cls of RETAIL_CLASS_MATRIX) {
    const spec = cls.specs.find((s) => s.slug === specSlug);
    if (spec) return spec.role.toLowerCase();
  }
  return null;
}
