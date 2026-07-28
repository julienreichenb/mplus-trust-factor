/** WoW class metadata for search suggestions and profile accents. */

export const CLASS_COLORS: Record<string, string> = {
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

export const CLASS_ICON_URLS: Record<string, string> = {
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

export function classColor(classSlug: string | null | undefined): string {
  if (!classSlug) return "var(--color-text)";
  return CLASS_COLORS[classSlug.toLowerCase()] ?? "var(--color-text)";
}

export function classIconUrl(classSlug: string | null | undefined): string | null {
  if (!classSlug) return null;
  return CLASS_ICON_URLS[classSlug.toLowerCase()] ?? null;
}
