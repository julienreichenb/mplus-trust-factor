import type { CharacterProfileView } from "../api/types";
import { isCharacterMediaEnabled } from "../config/features";
import { humanizeSlug } from "./characterViewModel";
import { readOptionalHttpsUrl, sanitizeHttpsUrl } from "./safeUrl";
import { classColor } from "./wowClass";
import { classIconName, specIconName, wowIconUrl } from "./wowIcons";

export type CharacterMediaType = "render" | "avatar" | "placeholder";
export type CharacterMediaSource = "profile" | "blizzard" | "fallback";
export type CharacterMediaCandidateKind = "main-raw" | "inset" | "avatar";

export interface CharacterMediaViewModel {
  type: CharacterMediaType;
  url: string | null;
  alt: string;
  source: CharacterMediaSource;
  caption: string;
}

/** One sanitized Blizzard media candidate in canonical ladder order. */
export interface CharacterMediaCandidate {
  kind: CharacterMediaCandidateKind;
  url: string;
  type: Exclude<CharacterMediaType, "placeholder">;
}

/** Identity used when every remote candidate is missing or fails. */
export interface CharacterMediaFallbackIdentity {
  displayName: string;
  classSlug: string | null;
  specSlug: string | null;
  role: string | null;
  caption: string;
  alt: string;
  classColor: string;
  /** Local monogram — always available offline. */
  initials: string;
  /**
   * Optional remote class/spec icon enhancement.
   * Must never be required for a character-specific fallback.
   */
  optionalIconUrl: string | null;
}

export interface CharacterMediaLadder {
  candidates: CharacterMediaCandidate[];
  fallback: CharacterMediaFallbackIdentity;
  /** First candidate as a single-URL view model (compat / caption helpers). */
  primary: CharacterMediaViewModel;
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

/** Offline-safe initials from the character display name. */
export function characterMediaInitials(displayName: string | null | undefined): string {
  const trimmed = displayName?.trim() ?? "";
  if (!trimmed) return "M+";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function resolveOptionalIconUrl(profile: CharacterProfileView): string | null {
  const specName = specIconName(profile.classSlug, profile.specSlug);
  const className = classIconName(profile.classSlug);
  return (
    sanitizeHttpsUrl(wowIconUrl(specName)) ?? sanitizeHttpsUrl(wowIconUrl(className)) ?? null
  );
}

function buildFallback(profile: CharacterProfileView): CharacterMediaFallbackIdentity {
  const caption = buildCaption(profile);
  return {
    displayName: profile.displayName || "Character",
    classSlug: profile.classSlug ?? null,
    specSlug: profile.specSlug ?? null,
    role: profile.role ?? null,
    caption,
    alt: buildAlt(profile, "placeholder"),
    classColor: classColor(profile.classSlug),
    initials: characterMediaInitials(profile.displayName),
    optionalIconUrl: resolveOptionalIconUrl(profile),
  };
}

/**
 * Accept https media URLs, plus same-origin `/fixtures/*` paths in mock mode for visual QA.
 */
export function sanitizeCharacterMediaUrl(raw: string | null | undefined): string | null {
  const https = sanitizeHttpsUrl(raw);
  if (https) return https;
  if (import.meta.env.VITE_API_MODE !== "mock") return null;
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/fixtures/")) return null;
  if (trimmed.includes("://") || trimmed.includes("..")) return null;
  return trimmed;
}

function pushCandidate(
  out: CharacterMediaCandidate[],
  seen: Set<string>,
  kind: CharacterMediaCandidateKind,
  raw: string | null,
  type: Exclude<CharacterMediaType, "placeholder">,
): void {
  const url = sanitizeCharacterMediaUrl(raw);
  if (!url || seen.has(url)) return;
  seen.add(url);
  out.push({ kind, url, type });
}

/**
 * Canonical provider ladder (Blizzard only):
 * 1. main-raw  2. inset  3. avatar
 * Legacy loose keys are accepted only after typed media fields.
 */
export function toCharacterMediaCandidates(profile: CharacterProfileView): CharacterMediaCandidate[] {
  if (!isCharacterMediaEnabled()) return [];

  const candidates: CharacterMediaCandidate[] = [];
  const seen = new Set<string>();

  const mainRaw =
    sanitizeCharacterMediaUrl(profile.media?.mainRawUrl ?? null) ??
    readOptionalHttpsUrl(profile, ["renderUrl", "characterRenderUrl", "mainRawUrl"]);
  pushCandidate(candidates, seen, "main-raw", mainRaw, "render");

  const inset =
    sanitizeCharacterMediaUrl(profile.media?.insetUrl ?? null) ??
    readOptionalHttpsUrl(profile, ["insetUrl", "bustUrl"]);
  pushCandidate(candidates, seen, "inset", inset, "avatar");

  const avatar =
    sanitizeCharacterMediaUrl(profile.media?.avatarUrl ?? null) ??
    readOptionalHttpsUrl(profile, ["avatarUrl"]);
  pushCandidate(candidates, seen, "avatar", avatar, "avatar");

  return candidates;
}

export function toCharacterMediaLadder(profile: CharacterProfileView): CharacterMediaLadder {
  const candidates = toCharacterMediaCandidates(profile);
  const fallback = buildFallback(profile);
  const first = candidates[0];
  const primary: CharacterMediaViewModel = first
    ? {
        type: first.type,
        url: first.url,
        alt: buildAlt(profile, first.type),
        source: "profile",
        caption: fallback.caption,
      }
    : {
        type: "placeholder",
        url: null,
        alt: fallback.alt,
        source: "fallback",
        caption: fallback.caption,
      };
  return { candidates, fallback, primary };
}

/**
 * Prefer trusted media URLs already present on the profile object.
 * Does not construct Blizzard CDN paths or fetch remote media.
 * Returns the first ladder candidate only — runtime fallbacks use {@link toCharacterMediaLadder}.
 */
export function toCharacterMediaViewModel(profile: CharacterProfileView): CharacterMediaViewModel {
  return toCharacterMediaLadder(profile).primary;
}

/** Stable signature so UI resets retry state when the character or candidate set changes. */
export function characterMediaCandidatesSignature(
  candidates: readonly CharacterMediaCandidate[],
  identityKey?: string | null,
): string {
  const urls = candidates.map((c) => `${c.kind}:${c.url}`).join("|");
  return `${identityKey ?? ""}::${urls}`;
}
