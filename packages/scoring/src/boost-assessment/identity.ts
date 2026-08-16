export type TeammateIdentityConfidence =
  | "character_id"
  | "provider_key"
  | "normalized_fallback"
  | "ambiguous";

export interface CanonicalTeammateIdentity {
  canonicalKey: string;
  confidence: TeammateIdentityConfidence;
}

export interface BoostRunParticipantInput {
  characterId?: string | null;
  providerCharacterKey?: string | null;
  regionCode: string;
  realmSlug: string;
  displayName?: string | null;
  isTargetCharacter: boolean;
  mythicRatingAtRun?: number | null;
  role?: string | null;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Durable identity first, then provider key, then normalized name.
 * Ambiguous identities must not become positive evidence.
 */
export function resolveCanonicalTeammateIdentity(
  participant: BoostRunParticipantInput,
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
