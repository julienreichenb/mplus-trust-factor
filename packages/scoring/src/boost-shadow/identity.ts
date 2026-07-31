import type { CanonicalTeammateIdentity, BoostShadowRunParticipantInput } from "./types.js";

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Canonical teammate identity (Locked preferred order).
 * Private — never expose keys publicly. Ambiguous identities are not merged.
 */
export function resolveCanonicalTeammateIdentity(
  participant: BoostShadowRunParticipantInput,
): CanonicalTeammateIdentity {
  if (participant.characterId && participant.characterId.trim().length > 0) {
    return {
      canonicalKey: `cid:${participant.characterId.trim()}`,
      confidence: "character_id",
    };
  }

  if (participant.providerCharacterKey && participant.providerCharacterKey.trim().length > 0) {
    const region = normalizeToken(participant.regionCode);
    return {
      canonicalKey: `pkey:${region}:${participant.providerCharacterKey.trim()}`,
      confidence: "provider_key",
    };
  }

  const name = participant.displayName?.trim();
  if (name && name.length > 0) {
    return {
      canonicalKey: `norm:${normalizeToken(participant.regionCode)}:${normalizeToken(participant.realmSlug)}:${normalizeToken(name)}`,
      confidence: "normalized_fallback",
    };
  }

  return {
    canonicalKey: `ambiguous:${normalizeToken(participant.regionCode)}:${normalizeToken(participant.realmSlug)}:unknown`,
    confidence: "ambiguous",
  };
}

export function isUsableTeammateIdentity(identity: CanonicalTeammateIdentity): boolean {
  return identity.confidence !== "ambiguous";
}
