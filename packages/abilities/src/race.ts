/**
 * Run-scoped race identity helpers for racial capability gating.
 * Prefer historical CombatantInfo / digest evidence — never current profile alone.
 */

/** Blizzard playable-race IDs → stable slugs used by AbilityRule.raceSlugs. */
const BLIZZARD_RACE_ID_TO_SLUG: Readonly<Record<number, string>> = {
  1: "human",
  2: "orc",
  3: "dwarf",
  4: "night-elf",
  5: "undead",
  6: "tauren",
  7: "gnome",
  8: "troll",
  9: "goblin",
  10: "blood-elf",
  11: "draenei",
  22: "worgen",
  24: "pandaren",
  25: "pandaren",
  26: "pandaren",
  27: "nightborne",
  28: "highmountain-tauren",
  29: "void-elf",
  30: "lightforged-draenei",
  31: "zandalari-troll",
  32: "kul-tiran",
  34: "dark-iron-dwarf",
  35: "vulpera",
  36: "maghar-orc",
  37: "mechagnome",
  52: "dracthyr",
  70: "dracthyr",
  84: "earthen",
  85: "earthen",
};

const ALIAS_TO_SLUG: Readonly<Record<string, string>> = {
  "night elf": "night-elf",
  nightelf: "night-elf",
  "blood elf": "blood-elf",
  bloodelf: "blood-elf",
  "dark iron dwarf": "dark-iron-dwarf",
  "dark-iron": "dark-iron-dwarf",
  "void elf": "void-elf",
  "kul tiran": "kul-tiran",
  "maghar orc": "maghar-orc",
  "mag'har orc": "maghar-orc",
  "highmountain tauren": "highmountain-tauren",
  "lightforged draenei": "lightforged-draenei",
  "zandalari troll": "zandalari-troll",
};

export type RaceEvidenceState = "KNOWN" | "UNKNOWN";

export function normalizeRaceSlug(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim().toLowerCase().replace(/_/g, "-");
  if (!trimmed) return null;
  return ALIAS_TO_SLUG[trimmed] ?? ALIAS_TO_SLUG[trimmed.replace(/-/g, " ")] ?? trimmed;
}

export function raceSlugFromBlizzardRaceId(
  raceId: number | null | undefined,
): string | null {
  if (raceId == null || !Number.isFinite(raceId) || raceId <= 0) return null;
  return BLIZZARD_RACE_ID_TO_SLUG[Math.floor(raceId)] ?? null;
}

export function raceCompatible(
  ruleRaceSlugs: readonly string[] | undefined,
  raceSlug: string | null | undefined,
): boolean {
  if (ruleRaceSlugs == null || ruleRaceSlugs.length === 0) return true;
  const normalized = normalizeRaceSlug(raceSlug);
  if (normalized == null) return false;
  return ruleRaceSlugs.some((r) => normalizeRaceSlug(r) === normalized);
}
