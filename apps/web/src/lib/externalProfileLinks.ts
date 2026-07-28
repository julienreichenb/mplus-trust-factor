import type { CharacterProfileView } from "../api/types";

export interface ExternalProfileLink {
  id: "warcraftlogs" | "raiderio" | "armory";
  label: string;
  href: string;
  logo: string;
  logoAlt: string;
}

function normalizeProviderKey(provider: string): string {
  const compact = provider.trim().toLowerCase().replace(/[_-]+/g, "");
  if (compact === "blizzard") return "BLIZZARD";
  if (compact === "raiderio") return "RAIDER_IO";
  if (compact === "warcraftlogs") return "WARCRAFT_LOGS";
  return provider.toUpperCase();
}

function sourceUrl(
  profile: CharacterProfileView,
  provider: "WARCRAFT_LOGS" | "RAIDER_IO" | "BLIZZARD",
): string | null {
  for (const source of profile.sources ?? []) {
    if (normalizeProviderKey(source.provider) === provider && source.url?.trim()) {
      return source.url.trim();
    }
  }
  for (const state of profile.providerStates ?? []) {
    if (normalizeProviderKey(String(state.provider)) === provider && state.sourceUrl?.trim()) {
      return state.sourceUrl.trim();
    }
  }
  return null;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

function encodeNameSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

/** Public profile URLs for WCL, Raider.IO, and Blizzard Armory. */
export function resolveExternalProfileLinks(profile: CharacterProfileView): ExternalProfileLink[] {
  const region = profile.region.toLowerCase();
  const realm = profile.realmSlug.trim().toLowerCase();
  const name = profile.displayName.trim();
  const nameLower = name.toLowerCase();

  const wcl =
    sourceUrl(profile, "WARCRAFT_LOGS") ??
    `https://www.warcraftlogs.com/character/${region}/${encodePathSegment(realm)}/${encodePathSegment(nameLower)}`;

  const raiderIo =
    sourceUrl(profile, "RAIDER_IO") ??
    profile.profileUrl?.trim() ??
    `https://raider.io/characters/${region}/${encodePathSegment(realm)}/${encodeNameSegment(name)}`;

  const armoryLocale = region === "eu" || region === "ru" || region === "kr" || region === "tw" ? "en-gb" : "en-us";
  const armory =
    sourceUrl(profile, "BLIZZARD") ??
    `https://worldofwarcraft.blizzard.com/${armoryLocale}/character/${region}/${encodePathSegment(realm)}/${encodePathSegment(nameLower)}`;

  return [
    {
      id: "warcraftlogs",
      label: "Warcraft Logs",
      href: wcl,
      logo: "/logos/warcraftlogs.png",
      logoAlt: "Warcraft Logs",
    },
    {
      id: "raiderio",
      label: "Raider.IO",
      href: raiderIo,
      logo: "/logos/raiderio.svg",
      logoAlt: "Raider.IO",
    },
    {
      id: "armory",
      label: "Blizzard Armory",
      href: armory,
      logo: "/logos/blizzard.svg",
      logoAlt: "Blizzard Armory",
    },
  ];
}
