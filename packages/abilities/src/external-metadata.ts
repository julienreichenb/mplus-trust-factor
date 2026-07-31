import type { AbilityExternalMetadata, AbilityRule } from "./types.js";
import { normalizeWowIconName, wowIconUrl } from "./wow-icons.js";

const WOWHEAD_HOST = "www.wowhead.com";

export function wowheadSpellUrl(spellId: number): string | null {
  if (!Number.isInteger(spellId) || spellId <= 0) return null;
  return `https://${WOWHEAD_HOST}/spell=${encodeURIComponent(String(spellId))}`;
}

/**
 * Derive external presentation metadata without scraping.
 * Icons use the approved Wowhead/Zamimg CDN when an icon identifier is known —
 * callers should treat iconUrl as best-effort and always provide a local fallback.
 */
export function buildExternalMetadata(
  spellId: number,
  options: { iconName?: string | null } = {},
): AbilityExternalMetadata {
  const url = wowheadSpellUrl(spellId);
  const iconName = normalizeWowIconName(options.iconName);
  const iconUrl = wowIconUrl(iconName);

  if (!url) {
    return {
      spellId,
      wowheadUrl: null,
      iconName,
      iconUrl,
      tooltipAvailable: false,
      metadataSource: iconUrl ? "WOWHEAD" : "FALLBACK",
    };
  }

  return {
    spellId,
    wowheadUrl: url,
    iconName,
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
      iconName: normalizeWowIconName(rule.iconName),
      iconUrl: wowIconUrl(rule.iconName),
      tooltipAvailable: false,
      metadataSource: "FALLBACK",
    };
  }
  return buildExternalMetadata(primary, { iconName: rule.iconName });
}
