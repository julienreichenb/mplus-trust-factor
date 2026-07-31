import {
  WOW_ICON_CDN_BASE,
  WOW_ICON_CDN_ORIGIN,
  WOW_ICON_FALLBACK_DATA_URI,
  normalizeWowIconName,
  wowIconSrc,
  wowIconUrl,
} from "@mplus/abilities";

export {
  WOW_ICON_CDN_BASE,
  WOW_ICON_CDN_ORIGIN,
  WOW_ICON_FALLBACK_DATA_URI,
  normalizeWowIconName,
  wowIconSrc,
  wowIconUrl,
};

/** Local deterministic class icon identifiers (not remote lookups). */
export const CLASS_ICON_NAMES: Readonly<Record<string, string>> = {
  warrior: "classicon_warrior",
  paladin: "classicon_paladin",
  hunter: "classicon_hunter",
  rogue: "classicon_rogue",
  priest: "classicon_priest",
  "death-knight": "classicon_deathknight",
  shaman: "classicon_shaman",
  mage: "classicon_mage",
  warlock: "classicon_warlock",
  monk: "classicon_monk",
  druid: "classicon_druid",
  "demon-hunter": "classicon_demonhunter",
  evoker: "classicon_evoker",
};

/** Role filter icons — readable labels accompany these; color is not the only cue. */
export const ROLE_ICON_NAMES = {
  TANK: "ability_warrior_defensivestance",
  HEALER: "spell_holy_flashheal",
  DPS: "ability_dualwield",
} as const;

export type AbilityRoleFilter = keyof typeof ROLE_ICON_NAMES;

export function classIconName(classSlug: string | null | undefined): string | null {
  if (!classSlug) return null;
  return CLASS_ICON_NAMES[classSlug.toLowerCase()] ?? null;
}

export function roleIconName(role: string | null | undefined): string | null {
  if (!role) return null;
  const key = role.toUpperCase() as AbilityRoleFilter;
  return ROLE_ICON_NAMES[key] ?? null;
}

export function roleIconUrl(role: string | null | undefined): string | null {
  return wowIconUrl(roleIconName(role));
}

export function filterOptionIconName(
  kind: "class" | "role",
  value: string,
): string | null {
  if (!value) return null;
  if (kind === "class") return classIconName(value);
  return roleIconName(value);
}
