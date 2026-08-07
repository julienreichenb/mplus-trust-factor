/**
 * Smoke orchestration helpers — no Blizzard-specific fetching here.
 * Cold/warm refresh uses the canonical production resolve/discover operation.
 */
import type { CharacterIdentityInput } from "@mplus/contracts";
import type { WorkerContainer } from "../../container.js";
import {
  resolveOrDiscoverPublicCharacter,
  type ResolveOrDiscoverPublicCharacterResult,
} from "../character-public-bootstrap.js";
import type { VerifiedSeasonAuthority } from "../season-authority.js";

export type PrepareSmokeCharacterResult = ResolveOrDiscoverPublicCharacterResult;

/**
 * Before runRefreshPipeline: resolve existing complete Character, or discover/bootstrap
 * via the same production Blizzard path used by public exact resolve.
 *
 * Replay / score-only must not call this.
 */
export async function prepareSmokeCharacterForRefresh(input: {
  container: WorkerContainer;
  identity: CharacterIdentityInput;
  authority: VerifiedSeasonAuthority;
  correlationId?: string | null;
}): Promise<PrepareSmokeCharacterResult> {
  return resolveOrDiscoverPublicCharacter({
    prisma: input.container.prisma,
    characterRepository: input.container.repositories.character,
    blizzard: input.container.providers.blizzard,
    identity: input.identity,
    authority: input.authority,
    correlationId: input.correlationId ?? null,
  });
}
