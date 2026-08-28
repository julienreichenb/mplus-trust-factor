/**
 * Explicit RELEASE-pinned character refresh (Phase 3B.4 test/operator path).
 * THIS DOES NOT ACTIVATE THE RELEASE.
 * Does not change default STATIC analyses.
 */

import {
  AbilityCatalogPinError,
  abilityCatalogExecutionKey,
  type AbilityCatalogExecutionPin,
} from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import { resolveActiveRefreshContract } from "@mplus/worker";
import { writeAuditEvent } from "../iam/audit.js";
import { HttpError } from "../errors.js";
import { resolveReleaseAbilityCatalogExecutionPin } from "./ability-catalog-execution-pin.js";
import type { AbilityCatalogReleaseAuditContext } from "./ability-catalog-release-service.js";
import type { ApiContainer } from "../container.js";

export type ExplicitReleaseTestRunInput = {
  releaseId: string;
  characterId?: string;
  region?: string;
  realmSlug?: string;
  name?: string;
  forceRefresh?: boolean;
};

export class AbilityCatalogReleaseTestRunService {
  constructor(private readonly container: ApiContainer) {}

  async enqueueExplicitReleaseRefresh(
    input: ExplicitReleaseTestRunInput,
    audit: AbilityCatalogReleaseAuditContext,
  ): Promise<{
    notice: string;
    pin: AbilityCatalogExecutionPin;
    jobId: string;
    dedupeKey: string;
    reused: boolean;
    enqueued: boolean;
    characterId: string;
  }> {
    const prisma = this.container.worker.prisma as PrismaClient;
    let pin: AbilityCatalogExecutionPin;
    try {
      pin = await resolveReleaseAbilityCatalogExecutionPin({
        prisma,
        releaseId: input.releaseId,
      });
    } catch (err) {
      if (err instanceof AbilityCatalogPinError) {
        throw HttpError.badRequest(err.code, err.message);
      }
      throw err;
    }

    const character = await this.resolveCharacter(prisma, input);
    const identity = {
      region: character.region.code,
      realmSlug: character.realm.slug,
      name: character.displayName,
    };

    const activeModel = await this.container.worker.repositories.score.getActiveModel("default");
    if (!activeModel) {
      throw HttpError.conflict("NO_ACTIVE_SCORE_MODEL", "No active score model");
    }
    const season = await prisma.season.findFirst({
      where: { regionId: character.regionId, isCurrent: true },
      orderBy: { startsAt: "desc" },
    });
    if (!season) {
      throw HttpError.conflict("NO_ACTIVE_SEASON", "No current season for character region");
    }

    const resolved = resolveActiveRefreshContract({
      scoringModelKey: activeModel.key,
      scoringModelVersion: activeModel.version,
      activeSeasonId: season.slug,
      providerMode: this.container.env.PROVIDER_MODE,
      abilityCatalogExecutionPin: pin,
    });

    const result = await this.container.producers.enqueueRefreshCharacter({
      characterId: character.id,
      region: identity.region,
      realmSlug: identity.realmSlug,
      name: identity.name,
      priority: "normal",
      forceRefresh: input.forceRefresh !== false,
      refreshContractHash: resolved.hash,
      scoringModelKey: resolved.contract.scoringModelKey,
      scoringModelVersion: resolved.contract.scoringModelVersion,
      triggerSource: "SYSTEM",
      authoritativeSeasonId: season.blizzardSeasonId ?? undefined,
      authoritativeSeasonSlug: season.slug,
      workloadClass: "OPERATION",
      abilityCatalogExecutionPin: pin,
    });

    await writeAuditEvent(prisma, {
      actorType: audit.actorType,
      userId: audit.userId,
      action: "admin.ability_catalog.release.test_run",
      resourceType: "ability_catalog_release",
      resourceId: pin.kind === "RELEASE" ? pin.releaseId : undefined,
      metadata: {
        notice: "THIS DOES NOT ACTIVATE THE RELEASE",
        releaseId: pin.kind === "RELEASE" ? pin.releaseId : null,
        releaseKey: pin.kind === "RELEASE" ? pin.releaseKey : null,
        contentDigest: pin.kind === "RELEASE" ? pin.contentDigest : null,
        executionKey: abilityCatalogExecutionKey(pin),
        characterId: character.id,
        jobId: result.jobId,
        enqueued: Boolean(result.enqueued),
        reused: Boolean(result.reused),
      },
      ip: audit.ip,
      userAgent: audit.userAgent,
      sessionSecret: audit.sessionSecret,
    });

    return {
      notice:
        "EXPLICIT RELEASE PIN != ACTIVE RELEASE. THIS DOES NOT CHANGE DEFAULT ANALYSES.",
      pin,
      jobId: result.jobId,
      dedupeKey: result.dedupeKey,
      reused: Boolean(result.reused),
      enqueued: Boolean(result.enqueued),
      characterId: character.id,
    };
  }

  private async resolveCharacter(
    prisma: PrismaClient,
    input: ExplicitReleaseTestRunInput,
  ) {
    if (input.characterId) {
      const row = await prisma.character.findUnique({
        where: { id: input.characterId },
        include: { region: true, realm: true },
      });
      if (!row) throw HttpError.notFound("CHARACTER_NOT_FOUND", "Character not found");
      return row;
    }
    if (!input.region || !input.realmSlug || !input.name) {
      throw HttpError.badRequest(
        "CHARACTER_IDENTITY_REQUIRED",
        "Provide characterId or region+realmSlug+name",
      );
    }
    const row = await prisma.character.findFirst({
      where: {
        region: { code: input.region.toUpperCase() },
        realm: { slug: input.realmSlug.toLowerCase() },
        displayName: { equals: input.name, mode: "insensitive" },
      },
      include: { region: true, realm: true },
    });
    if (!row) throw HttpError.notFound("CHARACTER_NOT_FOUND", "Character not found");
    return row;
  }
}
