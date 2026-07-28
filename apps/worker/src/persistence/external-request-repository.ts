import { createHash } from "node:crypto";
import type { ExternalPayload, ExternalRequest, PrismaClient } from "@mplus/database";
import type { ProviderName } from "@mplus/contracts";

export interface RecordRequestInput {
  provider: ProviderName;
  requestFingerprint: string;
  endpointKey: string;
  method: string;
  requestedAt: Date;
  completedAt?: Date | null;
  statusCode?: number | null;
  cacheHit?: boolean;
  retryCount?: number;
  costUnits?: number | null;
  errorCode?: string | null;
  expiresAt?: Date | null;
  /** Fixture/live payload body — never include secrets or auth tokens here. */
  payload?: unknown;
  schemaVersion?: string;
}

function toProviderEnum(provider: ProviderName): "BLIZZARD" | "WARCRAFT_LOGS" | "RAIDER_IO" {
  switch (provider) {
    case "blizzard":
      return "BLIZZARD";
    case "warcraftlogs":
      return "WARCRAFT_LOGS";
    case "raiderio":
      return "RAIDER_IO";
  }
}

export interface CachedExternalPayloadHit {
  request: ExternalRequest;
  payload: ExternalPayload;
}

export interface ExternalRequestRepository {
  recordRequestAndPayload(
    input: RecordRequestInput,
  ): Promise<{ request: ExternalRequest; payload: ExternalPayload | null }>;
  /**
   * Lookup a previously recorded payload by request fingerprint.
   * Returns null when missing, expired, or not linked to a payload row.
   */
  findFreshPayloadByFingerprint(input: {
    requestFingerprint: string;
    now?: Date;
  }): Promise<CachedExternalPayloadHit | null>;
}

export function createExternalRequestRepository(prisma: PrismaClient): ExternalRequestRepository {
  return {
    async recordRequestAndPayload(input) {
      const providerEnum = toProviderEnum(input.provider);
      const request = await prisma.externalRequest.upsert({
        where: { requestFingerprint: input.requestFingerprint },
        update: {
          completedAt: input.completedAt ?? null,
          statusCode: input.statusCode ?? null,
          cacheHit: input.cacheHit ?? false,
          retryCount: input.retryCount ?? 0,
          costUnits: input.costUnits ?? null,
          errorCode: input.errorCode ?? null,
          expiresAt: input.expiresAt ?? undefined,
        },
        create: {
          provider: providerEnum,
          requestFingerprint: input.requestFingerprint,
          endpointKey: input.endpointKey,
          method: input.method,
          requestedAt: input.requestedAt,
          completedAt: input.completedAt ?? null,
          statusCode: input.statusCode ?? null,
          cacheHit: input.cacheHit ?? false,
          retryCount: input.retryCount ?? 0,
          costUnits: input.costUnits ?? null,
          errorCode: input.errorCode ?? null,
          expiresAt: input.expiresAt ?? null,
        },
      });

      if (input.payload === undefined) {
        return { request, payload: null };
      }

      const contentHash = createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");
      const payload = await prisma.externalPayload.upsert({
        where: { provider_contentHash: { provider: providerEnum, contentHash } },
        update: {
          externalRequestId: request.id,
          fetchedAt: input.requestedAt,
          schemaVersion: input.schemaVersion ?? "fixture-v1",
        },
        create: {
          externalRequestId: request.id,
          provider: providerEnum,
          contentHash,
          payload: input.payload as object,
          fetchedAt: input.requestedAt,
          schemaVersion: input.schemaVersion ?? "fixture-v1",
        },
      });

      return { request, payload };
    },

    async findFreshPayloadByFingerprint(input) {
      const now = input.now ?? new Date();
      const request = await prisma.externalRequest.findUnique({
        where: { requestFingerprint: input.requestFingerprint },
        include: {
          payloads: {
            orderBy: { fetchedAt: "desc" },
            take: 1,
          },
        },
      });
      if (!request) return null;
      if (request.expiresAt && request.expiresAt.getTime() <= now.getTime()) {
        return null;
      }
      const payload = request.payloads[0] ?? null;
      if (!payload) {
        // Fallback: payload may be linked only via content-hash upsert without request relation update.
        const linked = await prisma.externalPayload.findFirst({
          where: { externalRequestId: request.id },
          orderBy: { fetchedAt: "desc" },
        });
        if (!linked) return null;
        return { request, payload: linked };
      }
      return { request, payload };
    },
  };
}
