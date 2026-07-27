import type { CharacterProfileView } from "../api/types";
import { isCharacterMediaEnabled } from "../config/features";
import { humanizeSlug } from "./characterViewModel";
import { readOptionalHttpsUrl, sanitizeHttpsUrl } from "./safeUrl";

export type CharacterMediaType = "render" | "avatar" | "placeholder";
export type CharacterMediaSource = "profile" | "blizzard" | "fallback";

export interface CharacterMediaViewModel {
  type: CharacterMediaType;
  url: string | null;
  alt: string;
  source: CharacterMediaSource;
  caption: string;
}

function buildCaption(profile: CharacterProfileView): string {
  const parts = [
    humanizeSlug(profile.specSlug),
    humanizeSlug(profile.classSlug),
    profile.role ? profile.role.toUpperCase() : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Character media unavailable";
}

function buildAlt(profile: CharacterProfileView, type: CharacterMediaType): string {
  const name = profile.displayName || "Character";
  if (type === "placeholder") return `Character media placeholder for ${name}`;
  if (type === "avatar") return `Avatar for ${name}`;
  return `Character render for ${name}`;
}

/**
 * Prefer trusted media URLs already present on the profile object.
 * Does not construct Blizzard CDN paths or fetch remote media.
 */
export function toCharacterMediaViewModel(profile: CharacterProfileView): CharacterMediaViewModel {
  const caption = buildCaption(profile);

  if (!isCharacterMediaEnabled()) {
    return {
      type: "placeholder",
      url: null,
      alt: buildAlt(profile, "placeholder"),
      source: "fallback",
      caption,
    };
  }

  const renderUrl =
    sanitizeHttpsUrl(profile.media?.mainRawUrl ?? null) ??
    readOptionalHttpsUrl(profile, ["renderUrl", "characterRenderUrl", "mainRawUrl"]);
  if (renderUrl) {
    return {
      type: "render",
      url: sanitizeHttpsUrl(renderUrl),
      alt: buildAlt(profile, "render"),
      source: "profile",
      caption,
    };
  }

  const avatarUrl =
    sanitizeHttpsUrl(profile.media?.avatarUrl ?? null) ??
    sanitizeHttpsUrl(profile.media?.insetUrl ?? null) ??
    readOptionalHttpsUrl(profile, ["avatarUrl", "insetUrl", "bustUrl"]);
  if (avatarUrl) {
    return {
      type: "avatar",
      url: sanitizeHttpsUrl(avatarUrl),
      alt: buildAlt(profile, "avatar"),
      source: "profile",
      caption,
    };
  }

  return {
    type: "placeholder",
    url: null,
    alt: buildAlt(profile, "placeholder"),
    source: "fallback",
    caption,
  };
}
