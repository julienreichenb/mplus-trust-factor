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
