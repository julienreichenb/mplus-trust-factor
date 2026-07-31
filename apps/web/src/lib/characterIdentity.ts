import { canonicalCharacterPath } from "./format";

export interface CharacterIdentityLike {
  region: string;
  realmSlug?: string;
  realm?: string;
  name: string;
}

export interface NormalizedCharacterIdentity {
  region: string;
  realmSlug: string;
  name: string;
}

export interface CharacterIdentityDisplayInput {
  region: string | null | undefined;
  name: string | null | undefined;
  /** Canonical realm slug for links/API — never mutated for display. */
  realmSlug?: string | null;
  /** Prefer human realm name when available for the server segment. */
  realmName?: string | null;
  classSlug?: string | null;
  className?: string | null;
  classColor?: string | null;
  avatarUrl?: string | null;
  classIconUrl?: string | null;
  portraitUrl?: string | null;
}

export interface CharacterIdentityDisplay {
  region: string;
  /** Display-capitalized nickname (does not mutate storage). */
  nickname: string;
  /** Display-capitalized server segment. */
  server: string;
  /** Canonical `Nickname-Server` visual pair. */
  nicknameServer: string;
  /** Full accessible label including class when known. */
  accessibleLabel: string;
  classSlug: string | null;
  className: string | null;
  classColor: string | null;
  portraitSrc: string | null;
  /** Canonical slug for routes/API. */
  realmSlug: string;
  /** Original name string for route params (unmutated). */
  nameForRoute: string;
}

/**
 * Display-capitalize a WoW name or realm segment without mutating storage.
 * Hyphen/space-separated parts get an initial capital; remaining characters keep case.
 */
export function displayCapitalize(value: string): string {
  return value
    .split(/([-\s])/)
    .map((part) => {
      if (!part || part === "-" || part === " " || part === "\t") return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

/**
 * Normalize region, realm slug and character name for identity comparison.
 * Name is lowercased for case-insensitive WoW matching while display stays separate.
 */
export function normalizeCharacterIdentity(
  identity: CharacterIdentityLike,
): NormalizedCharacterIdentity {
  const realm = identity.realmSlug ?? identity.realm ?? "";
  const path = canonicalCharacterPath(identity.region, realm, identity.name);
  return {
    region: path.region,
    realmSlug: path.realm,
    name: path.name.toLowerCase(),
  };
}

export function characterIdentityKey(identity: CharacterIdentityLike): string {
  const n = normalizeCharacterIdentity(identity);
  return `${n.region}|${n.realmSlug}|${n.name}`;
}

export function sameCharacterIdentity(
  a: CharacterIdentityLike,
  b: CharacterIdentityLike,
): boolean {
  return characterIdentityKey(a) === characterIdentityKey(b);
}

/**
 * Canonical visual identity formatting authority:
 * `[portrait] EU Charactername-Servername`
 */
export function formatCharacterIdentityDisplay(
  input: CharacterIdentityDisplayInput,
): CharacterIdentityDisplay {
  const regionRaw = (input.region ?? "").trim();
  const region = regionRaw ? regionRaw.toUpperCase() : "—";
  const nameRaw = (input.name ?? "").trim();
  const nickname = nameRaw ? displayCapitalize(nameRaw) : "?";
  const realmSlugRaw = (input.realmSlug ?? "").trim();
  const realmNameRaw = (input.realmName ?? "").trim();
  const serverSource = realmNameRaw || realmSlugRaw || "?";
  const server = serverSource === "?" ? "?" : displayCapitalize(serverSource);
  const nicknameServer = `${nickname}-${server}`;
  const classSlug = input.classSlug?.trim() || null;
  const className = input.className?.trim() || null;
  const classPart = className ? `${className} ` : classSlug ? `${classSlug} ` : "";
  const accessibleLabel = `${classPart}${nickname} on ${server}, ${region}`.trim();
  const portraitSrc =
    input.portraitUrl?.trim() ||
    input.avatarUrl?.trim() ||
    input.classIconUrl?.trim() ||
    null;

  return {
    region,
    nickname,
    server,
    nicknameServer,
    accessibleLabel,
    classSlug,
    className,
    classColor: input.classColor?.trim() || null,
    portraitSrc,
    realmSlug: realmSlugRaw.toLowerCase().replace(/\s+/g, "-"),
    nameForRoute: nameRaw,
  };
}
