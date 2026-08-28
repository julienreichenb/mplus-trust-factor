/**
 * Ability catalog release activation / rollback (Phase 3B.5 test-env).
 * Makes a VALIDATED (or SUPERSEDED) immutable release ACTIVE for NEW job pins.
 * Does not recompile. Does not mutate artifact bytes. Does not change already-pinned jobs.
 */

import type { Prisma, PrismaClient } from "@mplus/database";
import { ABILITY_CATALOG_ACTIVATABLE_RELEASE_STATUSES } from "@mplus/contracts";
import { writeAuditEvent } from "../iam/audit.js";
import { HttpError } from "../errors.js";
import {
  AbilityCatalogReleaseService,
  type AbilityCatalogReleaseAuditContext,
  type AbilityCatalogReleaseDTO,
} from "./ability-catalog-release-service.js";
import { AbilityCatalogReplayService } from "./ability-catalog-replay-service.js";

export type ActivateReleaseInput = {
  releaseId: string;
  /** Must equal candidate contentDigest (typed confirmation). */
  confirmationDigest: string;
  confirm: true;
  reason?: string;
  notes?: string;
  /** Optimistic concurrency: expected current ACTIVE id, or null if none. */
  expectedPreviousActiveId?: string | null;
};

export type AbilityCatalogReleaseActivationDTO = {
  id: string;
  releaseId: string;
  previousReleaseId: string | null;
  type: "PUBLISH" | "ROLLBACK";
  reason: string | null;
  notes: string | null;
  confirmationDigest: string;
  activatedAt: string;
  activatedByUserId: string | null;
};

function isActivatableStatus(status: string): boolean {
  return (ABILITY_CATALOG_ACTIVATABLE_RELEASE_STATUSES as readonly string[]).includes(
    status,
  );
}

export class AbilityCatalogReleaseActivationService {
  private readonly releases: AbilityCatalogReleaseService;
  private readonly replays: AbilityCatalogReplayService;

  constructor(private readonly prisma: PrismaClient) {
    this.releases = new AbilityCatalogReleaseService(prisma);
    this.replays = new AbilityCatalogReplayService(prisma);
  }

  async getActiveRelease(): Promise<AbilityCatalogReleaseDTO | null> {
    const row = await this.prisma.abilityCatalogRelease.findFirst({
      where: { status: "ACTIVE" },
    });
    return row ? this.releases.getRelease(row.id) : null;
  }

  async listActivations(limit = 20): Promise<{ activations: AbilityCatalogReleaseActivationDTO[] }> {
    const rows = await this.prisma.abilityCatalogReleaseActivation.findMany({
      orderBy: { activatedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return {
      activations: rows.map((r) => ({
        id: r.id,
        releaseId: r.releaseId,
        previousReleaseId: r.previousReleaseId,
        type: r.type,
        reason: r.reason,
        notes: r.notes,
        confirmationDigest: r.confirmationDigest,
        activatedAt: r.activatedAt.toISOString(),
        activatedByUserId: r.activatedByUserId,
      })),
    };
  }

  async activate(
    input: ActivateReleaseInput,
    audit: AbilityCatalogReleaseAuditContext,
    opts: { type: "PUBLISH" | "ROLLBACK" },
  ): Promise<{
    release: AbilityCatalogReleaseDTO;
    previousActive: AbilityCatalogReleaseDTO | null;
    activation: AbilityCatalogReleaseActivationDTO;
    notice: string;
  }> {
    if (input.confirm !== true) {
      throw HttpError.badRequest("CONFIRM_REQUIRED", "confirm: true is required");
    }
    if (!input.confirmationDigest || input.confirmationDigest.length !== 64) {
      throw HttpError.badRequest(
        "CONFIRMATION_DIGEST_REQUIRED",
        "confirmationDigest must be the 64-char contentDigest of the release",
      );
    }
    if (opts.type === "ROLLBACK" && !(input.reason && input.reason.trim().length > 0)) {
      throw HttpError.badRequest("ROLLBACK_REASON_REQUIRED", "Rollback requires a reason");
    }

    const candidate = await this.prisma.abilityCatalogRelease.findUnique({
      where: { id: input.releaseId },
    });
    if (!candidate) {
      throw HttpError.notFound("RELEASE_NOT_FOUND", "Ability catalog release not found");
    }
    if (candidate.status === "ACTIVE") {
      throw HttpError.conflict("ALREADY_ACTIVE", "Release is already ACTIVE");
    }
    if (!isActivatableStatus(candidate.status)) {
      throw HttpError.conflict(
        "RELEASE_NOT_ACTIVATABLE",
        `Only VALIDATED or SUPERSEDED releases can activate (got ${candidate.status})`,
      );
    }
    if (candidate.contentDigest !== input.confirmationDigest) {
      throw HttpError.badRequest(
        "CONFIRMATION_DIGEST_MISMATCH",
        "confirmationDigest does not match release contentDigest",
      );
    }

    // Integrity + validation re-check (no recompile).
    const loaded = await this.releases.loadReleaseArtifact(candidate.id);
    if (loaded.artifact.contentDigest !== candidate.contentDigest) {
      throw HttpError.conflict(
        "RELEASE_INTEGRITY_FAILED",
        "Release artifact integrity check failed",
      );
    }

    const gate = await this.replays.latestReplayGate(candidate.id);
    if (!gate.gate.replayPerformed || !gate.gate.pass) {
      throw HttpError.conflict(
        "REPLAY_GATE_FAILED",
        "Latest replay evidence must exist and PASS before activation",
        { gate: gate.gate, latestReplay: gate.latestReplay },
      );
    }

    const auditAction =
      opts.type === "ROLLBACK"
        ? "admin.ability_catalog.release.rollback"
        : "admin.ability_catalog.release.publish";

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Lock candidate + current ACTIVE row(s) so two concurrent activates cannot both
        // observe VALIDATED + the same previous ACTIVE and both commit.
        await tx.$queryRaw`
          SELECT id FROM ability_catalog_releases
          WHERE id = ${candidate.id}::uuid
             OR status = 'ACTIVE'::"AbilityCatalogReleaseStatus"
          FOR UPDATE
        `;

        const locked = await tx.abilityCatalogRelease.findUnique({
          where: { id: candidate.id },
        });
        if (!locked) {
          throw HttpError.notFound("RELEASE_NOT_FOUND", "Ability catalog release not found");
        }
        if (locked.status === "ACTIVE") {
          throw HttpError.conflict("ALREADY_ACTIVE", "Release is already ACTIVE");
        }
        if (!isActivatableStatus(locked.status)) {
          throw HttpError.conflict(
            "RELEASE_NOT_ACTIVATABLE",
            `Only VALIDATED or SUPERSEDED releases can activate (got ${locked.status})`,
          );
        }

        const previousActive = await tx.abilityCatalogRelease.findFirst({
          where: { status: "ACTIVE" },
        });

        if (input.expectedPreviousActiveId !== undefined) {
          const actualId = previousActive?.id ?? null;
          if (actualId !== input.expectedPreviousActiveId) {
            throw HttpError.conflict(
              "ACTIVE_RELEASE_CONFLICT",
              "expectedPreviousActiveId no longer matches (concurrent activation)",
              {
                expectedPreviousActiveId: input.expectedPreviousActiveId,
                actualPreviousActiveId: actualId,
              },
            );
          }
        }

        if (previousActive) {
          await tx.abilityCatalogRelease.update({
            where: { id: previousActive.id },
            data: { status: "SUPERSEDED" },
          });
        }

        const now = new Date();
        const activated = await tx.abilityCatalogRelease.update({
          where: { id: candidate.id },
          data: {
            status: "ACTIVE",
            publishedAt: locked.publishedAt ?? now,
          },
        });

        const activation = await tx.abilityCatalogReleaseActivation.create({
          data: {
            releaseId: activated.id,
            previousReleaseId: previousActive?.id ?? null,
            type: opts.type,
            reason: input.reason?.trim() || null,
            notes: input.notes?.trim() || null,
            confirmationDigest: input.confirmationDigest,
            activatedByUserId: audit.userId,
            activatedAt: now,
          },
        });

        return { activated, previousActive, activation };
      });

      await writeAuditEvent(this.prisma, {
        userId: audit.userId,
        actorType: audit.actorType,
        action: auditAction,
        resourceType: "ability_catalog_release",
        resourceId: result.activated.id,
        sessionSecret: audit.sessionSecret,
        ip: audit.ip,
        userAgent: audit.userAgent,
        metadata: {
          type: opts.type,
          releaseId: result.activated.id,
          releaseKey: result.activated.releaseKey,
          contentDigest: result.activated.contentDigest,
          previousReleaseId: result.previousActive?.id ?? null,
          activationId: result.activation.id,
          notice:
            "Activation changes pins for NEW jobs only. Already-enqueued jobs keep their pin. New analyses immediately use the ACTIVE release — no env change or restart.",
        },
      });

      return {
        release: await this.releases.getRelease(result.activated.id),
        previousActive: result.previousActive
          ? await this.releases.getRelease(result.previousActive.id)
          : null,
        activation: {
          id: result.activation.id,
          releaseId: result.activation.releaseId,
          previousReleaseId: result.activation.previousReleaseId,
          type: result.activation.type,
          reason: result.activation.reason,
          notes: result.activation.notes,
          confirmationDigest: result.activation.confirmationDigest,
          activatedAt: result.activation.activatedAt.toISOString(),
          activatedByUserId: result.activation.activatedByUserId,
        },
        notice:
          "Activation complete. New analyses immediately pin this release. Already-enqueued jobs keep their previous pin.",
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code === "P2002") {
        throw HttpError.conflict(
          "ACTIVE_RELEASE_CONFLICT",
          "Another ACTIVE release already exists (concurrent activation)",
        );
      }
      await writeAuditEvent(this.prisma, {
        userId: audit.userId,
        actorType: audit.actorType,
        action: "admin.ability_catalog.release.publish_failed",
        resourceType: "ability_catalog_release",
        resourceId: input.releaseId,
        sessionSecret: audit.sessionSecret,
        ip: audit.ip,
        userAgent: audit.userAgent,
        metadata: {
          type: opts.type,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }
}

/** Prisma client surface used in activation tests. */
export type ActivationPrisma = PrismaClient | Prisma.TransactionClient;
