/** Blizzard playable_class.id → canonical slug (retail). */
export const BLIZZARD_PLAYABLE_CLASS_ID_TO_SLUG: Readonly<Record<number, string>> = {
  1: "warrior",
  2: "paladin",
  3: "hunter",
  4: "rogue",
  5: "priest",
  6: "death-knight",
  7: "shaman",
  8: "mage",
  9: "warlock",
  10: "monk",
  11: "druid",
  12: "demon-hunter",
  13: "evoker",
};

export const WOW_CLASS_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  warrior: "Warrior",
  paladin: "Paladin",
  hunter: "Hunter",
  rogue: "Rogue",
  priest: "Priest",
  "death-knight": "Death Knight",
  shaman: "Shaman",
  mage: "Mage",
  warlock: "Warlock",
  monk: "Monk",
  druid: "Druid",
  "demon-hunter": "Demon Hunter",
  evoker: "Evoker",
};

/** Canonical WoW class colors (hex). Shared by API DTOs and UI. */
export const WOW_CLASS_COLORS: Readonly<Record<string, string>> = {
  warrior: "#C69B6D",
  paladin: "#F48CBA",
  hunter: "#AAD372",
  rogue: "#FFF468",
  priest: "#FFFFFF",
  "death-knight": "#C41E3A",
  shaman: "#0070DD",
  mage: "#3FC7EB",
  warlock: "#8788EE",
  monk: "#00FF98",
  druid: "#FF7C0A",
  "demon-hunter": "#A330C9",
  evoker: "#33937F",
};

const CLASS_ICON_BASE = "https://wow.zamimg.com/images/wow/icons/large";

export const WOW_CLASS_ICON_URLS: Readonly<Record<string, string>> = {
  warrior: `${CLASS_ICON_BASE}/classicon_warrior.jpg`,
  paladin: `${CLASS_ICON_BASE}/classicon_paladin.jpg`,
  hunter: `${CLASS_ICON_BASE}/classicon_hunter.jpg`,
  rogue: `${CLASS_ICON_BASE}/classicon_rogue.jpg`,
  priest: `${CLASS_ICON_BASE}/classicon_priest.jpg`,
  "death-knight": `${CLASS_ICON_BASE}/classicon_deathknight.jpg`,
  shaman: `${CLASS_ICON_BASE}/classicon_shaman.jpg`,
  mage: `${CLASS_ICON_BASE}/classicon_mage.jpg`,
  warlock: `${CLASS_ICON_BASE}/classicon_warlock.jpg`,
  monk: `${CLASS_ICON_BASE}/classicon_monk.jpg`,
  druid: `${CLASS_ICON_BASE}/classicon_druid.jpg`,
  "demon-hunter": `${CLASS_ICON_BASE}/classicon_demonhunter.jpg`,
  evoker: `${CLASS_ICON_BASE}/classicon_evoker.jpg`,
};

export interface WowClassPresentation {
  id: number | null;
  slug: string | null;
  name: string | null;
  color: string | null;
  iconUrl: string | null;
}

export function slugFromBlizzardPlayableClassId(id: number | null | undefined): string | null {
  if (id == null) return null;
  return BLIZZARD_PLAYABLE_CLASS_ID_TO_SLUG[id] ?? null;
}

export function presentWowClass(input: {
  playableClassId?: number | null;
  classSlug?: string | null;
}): WowClassPresentation {
  const slug =
    (input.classSlug?.toLowerCase() || null) ??
    slugFromBlizzardPlayableClassId(input.playableClassId ?? null);
  if (!slug) {
    return {
      id: input.playableClassId ?? null,
      slug: null,
      name: null,
      color: null,
      iconUrl: null,
    };
  }
  return {
    id: input.playableClassId ?? null,
    slug,
    name: WOW_CLASS_DISPLAY_NAMES[slug] ?? slug,
    color: WOW_CLASS_COLORS[slug] ?? null,
    iconUrl: WOW_CLASS_ICON_URLS[slug] ?? null,
  };
}
