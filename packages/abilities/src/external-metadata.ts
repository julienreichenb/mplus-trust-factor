import type { AbilityExternalMetadata, AbilityRule } from "./types.js";

const WOWHEAD_HOST = "www.wowhead.com";
/** Public Wowhead CDN icon path pattern (progressive enhancement only). */
const WOWHEAD_ICON_BASE = "https://wow.zamimg.com/images/wow/icons/large";

export function wowheadSpellUrl(spellId: number): string | null {
  if (!Number.isInteger(spellId) || spellId <= 0) return null;
  return `https://${WOWHEAD_HOST}/spell=${encodeURIComponent(String(spellId))}`;
}

/**
 * Derive external presentation metadata without scraping.
 * Icons use Wowhead's public CDN naming when an icon name is unknown — callers should
 * treat iconUrl as best-effort and always provide a local fallback.
 */
export function buildExternalMetadata(
  spellId: number,
  options: { iconName?: string | null } = {},
): AbilityExternalMetadata {
  const url = wowheadSpellUrl(spellId);
  if (!url) {
    return {
      spellId,
      wowheadUrl: null,
      iconUrl: null,
      tooltipAvailable: false,
      metadataSource: "FALLBACK",
    };
  }

  const iconUrl = options.iconName
    ? `${WOWHEAD_ICON_BASE}/${options.iconName}.jpg`
    : null;

  return {
    spellId,
    wowheadUrl: url,
    iconUrl,
    tooltipAvailable: true,
    metadataSource: iconUrl ? "WOWHEAD" : "FALLBACK",
  };
}

export function enrichRuleExternalMetadata(rule: AbilityRule): AbilityExternalMetadata {
  const primary = rule.spellIds[0];
  if (primary == null) {
    return {
      spellId: 0,
      wowheadUrl: null,
      iconUrl: null,
      tooltipAvailable: false,
      metadataSource: "FALLBACK",
    };
  }
  return buildExternalMetadata(primary);
}
