import type { RetailClassDefinition } from "../types.js";

/**
 * Canonical Retail playable class/spec matrix for Midnight.
 * Generated from official Blizzard playable-class / specialization indexes
 * (curated snapshot; do not hardcode counts elsewhere — consume this matrix).
 *
 * Provenance: Blizzard Game Data playable class + specialization indexes,
 * verified 2026-07-28 against Midnight live roster (13 classes, 40 specs including Devourer).
 */
export const RETAIL_CLASS_MATRIX: RetailClassDefinition[] = [
  {
    slug: "death-knight",
    name: "Death Knight",
    supportState: "SUPPORTED",
    specs: [
      { slug: "blood", name: "Blood", role: "TANK", supportState: "SUPPORTED" },
      { slug: "frost", name: "Frost", role: "DPS", supportState: "SUPPORTED" },
      { slug: "unholy", name: "Unholy", role: "DPS", supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "demon-hunter",
    name: "Demon Hunter",
    supportState: "PARTIAL",
    notes: "Devourer is Midnight-new; class utilities supported, Devourer-specific toolkit marked uncertain.",
    specs: [
      { slug: "havoc", name: "Havoc", role: "DPS", supportState: "SUPPORTED" },
      { slug: "vengeance", name: "Vengeance", role: "TANK", supportState: "SUPPORTED" },
      {
        slug: "devourer",
        name: "Devourer",
        role: "DPS",
        supportState: "UNCERTAIN",
        notes: "New Midnight specialization — class-shared utilities only until Blizzard spell IDs are re-verified.",
      },
    ],
  },
  {
    slug: "druid",
    name: "Druid",
    supportState: "SUPPORTED",
    specs: [
      { slug: "balance", name: "Balance", role: "DPS", supportState: "SUPPORTED" },
      { slug: "feral", name: "Feral", role: "DPS", supportState: "SUPPORTED" },
      { slug: "guardian", name: "Guardian", role: "TANK", supportState: "SUPPORTED" },
      { slug: "restoration", name: "Restoration", role: "HEALER", supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "evoker",
    name: "Evoker",
    supportState: "SUPPORTED",
    specs: [
      { slug: "devastation", name: "Devastation", role: "DPS", supportState: "SUPPORTED" },
      { slug: "preservation", name: "Preservation", role: "HEALER", supportState: "SUPPORTED" },
      { slug: "augmentation", name: "Augmentation", role: "DPS", supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "hunter",
    name: "Hunter",
    supportState: "SUPPORTED",
    specs: [
      { slug: "beast-mastery", name: "Beast Mastery", role: "DPS", supportState: "SUPPORTED" },
      { slug: "marksmanship", name: "Marksmanship", role: "DPS", supportState: "SUPPORTED" },
      { slug: "survival", name: "Survival", role: "DPS", supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "mage",
    name: "Mage",
    supportState: "SUPPORTED",
    specs: [
      { slug: "arcane", name: "Arcane", role: "DPS", supportState: "SUPPORTED" },
      { slug: "fire", name: "Fire", role: "DPS", supportState: "SUPPORTED" },
      { slug: "frost", name: "Frost", role: "DPS", supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "monk",
    name: "Monk",
    supportState: "SUPPORTED",
    specs: [
      { slug: "brewmaster", name: "Brewmaster", role: "TANK", supportState: "SUPPORTED" },
      { slug: "mistweaver", name: "Mistweaver", role: "HEALER", supportState: "SUPPORTED" },
      { slug: "windwalker", name: "Windwalker", role: "DPS", supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "paladin",
    name: "Paladin",
    supportState: "SUPPORTED",
    specs: [
      { slug: "holy", name: "Holy", role: "HEALER", supportState: "SUPPORTED" },
      { slug: "protection", name: "Protection", role: "TANK", supportState: "SUPPORTED" },
      { slug: "retribution", name: "Retribution", role: "DPS", supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "priest",
    name: "Priest",
    supportState: "SUPPORTED",
    specs: [
      { slug: "discipline", name: "Discipline", role: "HEALER", supportState: "SUPPORTED" },
      { slug: "holy", name: "Holy", role: "HEALER", supportState: "SUPPORTED" },
      { slug: "shadow", name: "Shadow", role: "DPS", supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "rogue",
    name: "Rogue",
    supportState: "SUPPORTED",
    specs: [
      { slug: "assassination", name: "Assassination", role: "DPS", supportState: "SUPPORTED" },
      { slug: "outlaw", name: "Outlaw", role: "DPS", supportState: "SUPPORTED" },
      { slug: "subtlety", name: "Subtlety", role: "DPS", supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "shaman",
    name: "Shaman",
    supportState: "SUPPORTED",
    specs: [
      { slug: "elemental", name: "Elemental", role: "DPS", supportState: "SUPPORTED" },
      { slug: "enhancement", name: "Enhancement", role: "DPS", supportState: "SUPPORTED" },
      { slug: "restoration", name: "Restoration", role: "HEALER", supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "warlock",
    name: "Warlock",
    supportState: "SUPPORTED",
    specs: [
      { slug: "affliction", name: "Affliction", role: "DPS", supportState: "SUPPORTED" },
      { slug: "demonology", name: "Demonology", role: "DPS", supportState: "SUPPORTED" },
      { slug: "destruction", name: "Destruction", role: "DPS", supportState: "SUPPORTED" },
    ],
  },
  {
    slug: "warrior",
    name: "Warrior",
    supportState: "SUPPORTED",
    specs: [
      { slug: "arms", name: "Arms", role: "DPS", supportState: "SUPPORTED" },
      { slug: "fury", name: "Fury", role: "DPS", supportState: "SUPPORTED" },
      { slug: "protection", name: "Protection", role: "TANK", supportState: "SUPPORTED" },
    ],
  },
];

export function findClassDefinition(classSlug: string): RetailClassDefinition | undefined {
  return RETAIL_CLASS_MATRIX.find((c) => c.slug === classSlug);
}

export function findSpecDefinition(classSlug: string, specSlug: string) {
  const cls = findClassDefinition(classSlug);
  if (!cls) return undefined;
  return cls.specs.find((s) => s.slug === specSlug);
}
