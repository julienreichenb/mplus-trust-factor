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

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const digits = match?.[1];
  if (!digits) return null;
  const n = Number.parseInt(digits, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Pick black or white text for WCAG contrast against a hex background. */
export function contrastingTextColor(backgroundHex: string): "#000000" | "#ffffff" {
  const rgb = hexToRgb(backgroundHex);
  if (!rgb) return "#ffffff";
  return relativeLuminance(...rgb) > 0.179 ? "#000000" : "#ffffff";
}

export function classIconUrl(classSlug: string | null | undefined): string | null {
  if (!classSlug) return null;
  return CLASS_ICON_URLS[classSlug.toLowerCase()] ?? null;
}
