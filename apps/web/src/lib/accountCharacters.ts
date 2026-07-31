import type { AccountOwnedCharacterDTO } from "@mplus/contracts";
import { classColor, classIconUrl } from "./wowClass";
import { sameCharacterIdentity, type CharacterIdentityLike } from "./characterIdentity";
import { canonicalCharacterPath } from "./format";

export function accountCharacterPortraitSrc(c: AccountOwnedCharacterDTO): string | null {
  return c.media.portraitUrl ?? classIconUrl(c.characterClass.slug);
}

export function accountCharacterClassColor(c: AccountOwnedCharacterDTO): string {
  return c.characterClass.color ?? classColor(c.characterClass.slug);
}

export function accountCharacterRoute(c: AccountOwnedCharacterDTO) {
  const path = canonicalCharacterPath(c.region, c.realmSlug, c.name);
  return {
    name: "character" as const,
    params: {
      region: path.region.toLowerCase(),
      realm: path.realm,
      name: path.name,
    },
  };
}

export function formatAccountMythicScore(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating)) return "No score";
  return String(Math.round(rating));
}

export function isOwnedAccountCharacter(
  characters: AccountOwnedCharacterDTO[],
  current: CharacterIdentityLike,
): boolean {
  return characters.some((c) =>
    sameCharacterIdentity(
      { region: c.region, realmSlug: c.realmSlug, name: c.name },
      current,
    ),
  );
}

/** Other linked characters for the switcher, Mythic+ score descending (missing last). */
export function switcherCharactersExcludingCurrent(
  characters: AccountOwnedCharacterDTO[],
  current: CharacterIdentityLike,
): AccountOwnedCharacterDTO[] {
  return characters
    .filter(
      (c) =>
        !sameCharacterIdentity(
          { region: c.region, realmSlug: c.realmSlug, name: c.name },
          current,
        ),
    )
    .slice()
    .sort((a, b) => {
      const ra = a.currentSeasonMythic.rating;
      const rb = b.currentSeasonMythic.rating;
      const aMissing = ra == null || !Number.isFinite(ra);
      const bMissing = rb == null || !Number.isFinite(rb);
      if (aMissing && bMissing) return a.name.localeCompare(b.name);
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (rb !== ra) return (rb as number) - (ra as number);
      return a.name.localeCompare(b.name);
    });
}
