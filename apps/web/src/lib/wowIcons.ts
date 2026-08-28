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

/**
 * Playable-race icons keyed by AbilityRule race slug (CDN race_* / allied-race assets).
 * Used when a review/catalog item is racial rather than class/spec-owned.
 */
export const RACE_ICON_NAMES: Readonly<Record<string, string>> = {
  human: "race_human_male",
  orc: "race_orc_male",
  dwarf: "race_dwarf_male",
  "night-elf": "race_nightelf_male",
  undead: "race_scourge_male",
  tauren: "race_tauren_male",
  gnome: "race_gnome_male",
  troll: "race_troll_male",
  goblin: "race_goblin_male",
  "blood-elf": "race_bloodelf_male",
  draenei: "race_draenei_male",
  worgen: "race_worgen_male",
  pandaren: "race_pandaren_male",
  nightborne: "race_nightborne_male",
  "highmountain-tauren": "race_highmountaintauren_male",
  "void-elf": "race_voidelf_male",
  "lightforged-draenei": "race_lightforgeddraenei_male",
  "zandalari-troll": "achievement_alliedrace_zandalaritroll",
  "kul-tiran": "race_kultiran_male",
  "dark-iron-dwarf": "race_darkirondwarf_male",
  vulpera: "race_vulpera_male",
  "maghar-orc": "race_magharorc_male",
  mechagnome: "race_mechagnome_male",
  dracthyr: "race_dracthyr_male",
  earthen: "race_earthendwarf_male",
};

/**
 * Spec icons keyed by `classSlug:specSlug` (Retail specialization media names).
 * Used for admin catalog disclosure toggles — not remote lookups.
 */
export const SPEC_ICON_NAMES: Readonly<Record<string, string>> = {
  "death-knight:blood": "spell_deathknight_bloodpresence",
  "death-knight:frost": "spell_deathknight_frostpresence",
  "death-knight:unholy": "spell_deathknight_unholypresence",
  "demon-hunter:havoc": "ability_demonhunter_specdps",
  "demon-hunter:vengeance": "ability_demonhunter_spectank",
  "demon-hunter:devourer": "ability_demonhunter_eyebeam",
  "druid:balance": "spell_nature_starfall",
  "druid:feral": "ability_druid_catform",
  "druid:guardian": "ability_racial_bearform",
  "druid:restoration": "spell_nature_healingtouch",
  "evoker:devastation": "classicon_evoker_devastation",
  "evoker:preservation": "classicon_evoker_preservation",
  "evoker:augmentation": "classicon_evoker_augmentation",
  "hunter:beast-mastery": "ability_hunter_bestialdiscipline",
  "hunter:marksmanship": "ability_hunter_focusedaim",
  "hunter:survival": "ability_hunter_camouflage",
  "mage:arcane": "spell_holy_magicalsentry",
  "mage:fire": "spell_fire_firebolt02",
  "mage:frost": "spell_frost_frostbolt02",
  "monk:brewmaster": "spell_monk_brewmaster_spec",
  "monk:mistweaver": "spell_monk_mistweaver_spec",
  "monk:windwalker": "spell_monk_windwalker_spec",
  "paladin:holy": "spell_holy_holybolt",
  "paladin:protection": "ability_paladin_shieldofthetemplar",
  "paladin:retribution": "spell_holy_auraoflight",
  "priest:discipline": "spell_holy_powerwordshield",
  "priest:holy": "spell_holy_guardianspirit",
  "priest:shadow": "spell_shadow_shadowwordpain",
  "rogue:assassination": "ability_rogue_deadlybrew",
  "rogue:outlaw": "ability_rogue_waylay",
  "rogue:subtlety": "ability_stealth",
  "shaman:elemental": "spell_nature_lightning",
  "shaman:enhancement": "spell_shaman_improvedstormstrike",
  "shaman:restoration": "spell_nature_magicimmunity",
  "warlock:affliction": "spell_shadow_deathcoil",
  "warlock:demonology": "spell_shadow_metamorphosis",
  "warlock:destruction": "spell_shadow_rainoffire",
  "warrior:arms": "ability_warrior_savageblow",
  "warrior:fury": "ability_warrior_innerrage",
  "warrior:protection": "ability_warrior_defensivestance",
};

export type AbilityRoleFilter = keyof typeof ROLE_ICON_NAMES;

export function classIconName(classSlug: string | null | undefined): string | null {
  if (!classSlug) return null;
  return CLASS_ICON_NAMES[classSlug.toLowerCase()] ?? null;
}

/** Spec icon for a class+spec pair; falls back to class icon when unknown / class-wide. */
export function specIconName(
  classSlug: string | null | undefined,
  specSlug: string | null | undefined,
): string | null {
  const cls = classSlug?.toLowerCase() ?? "";
  const spec = specSlug?.toLowerCase() ?? "";
  if (!cls) return null;
  if (!spec) return classIconName(cls);
  return SPEC_ICON_NAMES[`${cls}:${spec}`] ?? classIconName(cls);
}

/** Race icon for a playable race slug; null when unknown. */
export function raceIconName(raceSlug: string | null | undefined): string | null {
  if (!raceSlug) return null;
  return RACE_ICON_NAMES[raceSlug.toLowerCase()] ?? null;
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
