import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@mplus/database";
import {
  artifactFromSemanticContentBytes,
  casHashOfSemanticBytes,
  compareStaticCatalogToReleaseArtifact,
  compileAbilityCatalogRelease,
  compileBootstrapRelease0,
  diffReleaseArtifacts,
  serializeSemanticReleaseContentBytes,
  topologyCounts,
  validateAbilityCatalogReleaseArtifact,
  type AbilityCatalogReleaseArtifact,
  type AbilityCatalogReleaseManifest,
  type CompiledCatalogChange,
  type ReleaseCurationEntry,
  type ReleaseDiffDocument,
  type ReleaseTopology,
  ABILITY_CATALOG_RELEASE_SCHEMA_V1,
  projectDraftRuleForRelease,
} from "@mplus/abilities/release";
import type { AbilityRule, AbilityRole } from "@mplus/abilities";
import { canonicalRoleForClassSpec } from "@mplus/abilities";
import { writeAuditEvent } from "../iam/audit.js";
import { HttpError } from "../errors.js";
import { persistInternalBytes } from "./ability-catalog-review-service.js";
import { listCanonicalKeysPendingExclusionTombstone } from "./ability-catalog-mplus-context.js";

export const ABILITY_CATALOG_RELEASE_VALIDATOR_VERSION = "ability-catalog-release-validator-v1";
export const ARTIFACT_CLASS_RELEASE = "ability_catalog_release";
export const ARTIFACT_CLASS_RELEASE_VALIDATION = "ability_catalog_release_validation";
export const OWNER_RELEASE = "ability_catalog_release";

export type AbilityCatalogReleaseAuditContext = {
  userId: string | null;
  actorType: "user" | "admin_key" | "system" | "anonymous";
  ip?: string | null;
  userAgent?: string | null;
  sessionSecret: string;
};

export type IncludedDraftRuleRef = {
  draftRuleId: string;
  draftVersion: number;
};

export type IncludedDraftTopologyRef = {
  draftTopologyId: string;
  draftVersion: number;
};

export type IncludedRemovalRef = {
  reviewItemId: string;
  draftVersion?: number;
  validToBuild: string;
  decisionEventId?: string;
};

export type CreateReleaseCandidateInput = {
  baseReleaseId: string;
  includedDraftRuleIds?: IncludedDraftRuleRef[];
  includedDraftTopologyIds?: IncludedDraftTopologyRef[];
  includedRemovalItemIds?: IncludedRemovalRef[];
  /** Optional explicit wowBuild for the candidate (does not rewrite Bootstrap). */
  wowBuild?: string;
  notes?: string;
};

type PersistCompiledInput = {
  artifact: AbilityCatalogReleaseArtifact;
  previousReleaseId: string | null;
  diff: ReleaseDiffDocument;
  requireParityPass?: boolean;
  notes?: string | null;
};

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function draftBindingsToRuleFields(bindings: unknown): {
  aliases?: number[];
  activationSpellIds?: number[];
  activationBuffIds?: number[];
  triggeredEffectIds?: number[];
} {
  if (!Array.isArray(bindings)) return {};
  const aliases: number[] = [];
  const activationSpellIds: number[] = [];
  const activationBuffIds: number[] = [];
  const triggeredEffectIds: number[] = [];
  for (const raw of bindings) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as { spellId?: unknown; role?: unknown };
    if (typeof b.spellId !== "number" || b.spellId <= 0) continue;
    switch (b.role) {
      case "CAST_ALIAS":
        aliases.push(b.spellId);
        break;
      case "PRIMARY_ACTIVATION":
        activationSpellIds.push(b.spellId);
        break;
      case "ACTIVATION_AURA":
      case "STACK_AURA":
        activationBuffIds.push(b.spellId);
        break;
      case "TRIGGERED_EFFECT":
      case "SUMMON":
        triggeredEffectIds.push(b.spellId);
        break;
      default:
        break;
    }
  }
  return {
    ...(aliases.length ? { aliases } : {}),
    ...(activationSpellIds.length ? { activationSpellIds } : {}),
    ...(activationBuffIds.length ? { activationBuffIds } : {}),
    ...(triggeredEffectIds.length ? { triggeredEffectIds } : {}),
  };
}

export function draftRuleRowToAbilityRule(
  row: {
  canonicalKey: string | null;
  name: string;
  spellIds: unknown;
  bindings: unknown;
  iconName: string | null;
  classSlug: string | null;
  specSlugs: unknown;
  raceSlugs: unknown;
  category: string | null;
  dimensionTags: unknown;
  availability: string | null;
  cooldownSeconds: number | null;
  charges: number | null;
  sourceOwnership: string | null;
  provenance: unknown;
  validityBuild: string | null;
},
  options?: { topology?: ReleaseTopology },
): AbilityRule {
  if (!row.canonicalKey) {
    throw HttpError.badRequest("DRAFT_MISSING_CANONICAL_KEY", "Draft rule missing canonicalKey");
  }
  if (!row.category) {
    throw HttpError.badRequest("DRAFT_MISSING_CATEGORY", "Draft rule missing category");
  }
  const spellIds = asNumberArray(row.spellIds);
  if (spellIds.length === 0) {
    throw HttpError.badRequest("DRAFT_EMPTY_SPELL_IDS", "Draft rule has empty spellIds");
  }
  const specSlugs = asStringArray(row.specSlugs);
  const raceSlugs = asStringArray(row.raceSlugs);
  let roles: AbilityRole[] = ["DPS"];
  if (row.classSlug && specSlugs.length === 1) {
    const role = canonicalRoleForClassSpec(row.classSlug, specSlugs[0]!);
    if (role) roles = [role];
  } else if (row.classSlug && specSlugs.length === 0) {
    roles = ["DPS", "TANK", "HEALER"];
  }

  const provenanceRaw =
    row.provenance && typeof row.provenance === "object" && !Array.isArray(row.provenance)
      ? (row.provenance as Record<string, unknown>)
      : {};

  const bindingFields = draftBindingsToRuleFields(row.bindings);

  const baseRule: AbilityRule = {
    canonicalKey: row.canonicalKey,
    name: row.name,
    spellIds,
    ...(row.iconName !== undefined && row.iconName !== null ? { iconName: row.iconName } : {}),
    classSlug: row.classSlug,
    specSlugs,
    roles,
    category: row.category as AbilityRule["category"],
    ...(asStringArray(row.dimensionTags).length
      ? { dimensionTags: asStringArray(row.dimensionTags) as AbilityRule["dimensionTags"] }
      : {}),
    sourceOwnership: (row.sourceOwnership as AbilityRule["sourceOwnership"]) ?? "PLAYER",
    sharedAcrossSpecs: specSlugs.length === 0,
    availability: (row.availability as AbilityRule["availability"]) ?? "BASELINE",
    ...(row.cooldownSeconds != null ? { cooldownSeconds: row.cooldownSeconds } : {}),
    ...(row.charges != null ? { charges: row.charges } : {}),
    ...(raceSlugs.length ? { raceSlugs } : {}),
    ...bindingFields,
    provenance: {
      source: (typeof provenanceRaw.source === "string"
        ? provenanceRaw.source
        : "CURATED_OVERRIDE") as AbilityRule["provenance"]["source"],
      verifiedAt:
        typeof provenanceRaw.verifiedAt === "string"
          ? provenanceRaw.verifiedAt
          : new Date().toISOString().slice(0, 10),
      gameVersion:
        typeof provenanceRaw.gameVersion === "string" ? provenanceRaw.gameVersion : "12.0.0",
      ...(typeof provenanceRaw.notes === "string" ? { notes: provenanceRaw.notes } : {}),
      ...(typeof provenanceRaw.certainty === "string"
        ? { certainty: provenanceRaw.certainty as AbilityRule["provenance"]["certainty"] }
        : { certainty: "verified" as const }),
    },
    ...(row.validityBuild ? { validFromBuild: row.validityBuild } : {}),
  };
  return options?.topology ? projectDraftRuleForRelease(baseRule, options.topology) : baseRule;
}

export function applyTopologyDraft(
  base: ReleaseTopology,
  draft: { kind: string; slug: string; displayName: string | null; evidence: unknown },
): ReleaseTopology {
  const next = structuredClone(base);
  if (draft.kind === "RACE" || draft.kind === "race") {
    const evidence =
      draft.evidence && typeof draft.evidence === "object" && !Array.isArray(draft.evidence)
        ? (draft.evidence as Record<string, unknown>)
        : {};
    const blizzardRaceIds = asNumberArray(evidence.blizzardRaceIds);
    const existing = next.races.find((r) => r.slug === draft.slug);
    if (existing) {
      existing.blizzardRaceIds = [
        ...new Set([...existing.blizzardRaceIds, ...blizzardRaceIds]),
      ].sort((a, b) => a - b);
    } else {
      next.races.push({
        slug: draft.slug,
        blizzardRaceIds: blizzardRaceIds.length ? blizzardRaceIds : [],
      });
      next.races.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    }
    return next;
  }
  throw HttpError.badRequest(
    "UNSUPPORTED_TOPOLOGY_DRAFT_KIND",
    `Topology draft kind ${draft.kind} is not supported for compile`,
  );
}

export class AbilityCatalogReleaseService {
  constructor(private readonly prisma: PrismaClient) {}

  async persistBootstrapRelease0(
    audit: AbilityCatalogReleaseAuditContext,
  ): Promise<{ release: AbilityCatalogReleaseDTO; created: boolean; parityPass: boolean }> {
    const bootstrap = compileBootstrapRelease0();
    if (!bootstrap.validation.valid || bootstrap.parity.overall !== "PASS") {
      throw HttpError.conflict(
        "BOOTSTRAP_PARITY_FAILED",
        "Bootstrap Release 0 must validate and pass parity before persist",
        {
          validationValid: bootstrap.validation.valid,
          parity: bootstrap.parity.overall,
        },
      );
    }

    const expectedDigest =
      "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761";
    const expectedKey = "wow-unknown-static/catalog-v1/fe8c9a03";
    if (bootstrap.artifact.contentDigest !== expectedDigest) {
      throw HttpError.conflict(
        "BOOTSTRAP_DIGEST_DRIFT",
        `Bootstrap contentDigest drifted from accepted 3B.1 value. expected=${expectedDigest} got=${bootstrap.artifact.contentDigest}`,
      );
    }
    if (bootstrap.artifact.releaseKey !== expectedKey) {
      throw HttpError.conflict(
        "BOOTSTRAP_KEY_DRIFT",
        `Bootstrap releaseKey drifted from accepted 3B.1 value. expected=${expectedKey} got=${bootstrap.artifact.releaseKey}`,
      );
    }

    const result = await this.persistCompiledRelease(
      {
        artifact: bootstrap.artifact,
        previousReleaseId: null,
        diff: { kind: "BOOTSTRAP", entries: [] },
        requireParityPass: true,
        notes: "Bootstrap Release 0 — VALIDATED only; NOT ACTIVE",
      },
      audit,
      {
        auditAction: "admin.ability_catalog.release.bootstrap_persisted",
        forceStatus: "VALIDATED",
      },
    );

    await this.audit("admin.ability_catalog.release.bootstrap_persisted", result.release.id, audit, {
      created: result.created,
      releaseKey: result.release.releaseKey,
      contentDigest: result.release.contentDigest,
      status: result.release.status,
    });

    return { ...result, parityPass: true };
  }

  async createReleaseCandidate(
    input: CreateReleaseCandidateInput,
    audit: AbilityCatalogReleaseAuditContext,
  ): Promise<{ release: AbilityCatalogReleaseDTO; created: boolean }> {
    await this.audit("admin.ability_catalog.release.compile_requested", input.baseReleaseId, audit, {
      baseReleaseId: input.baseReleaseId,
      draftRuleCount: input.includedDraftRuleIds?.length ?? 0,
      draftTopologyCount: input.includedDraftTopologyIds?.length ?? 0,
      removalCount: input.includedRemovalItemIds?.length ?? 0,
    });

    const loaded = await this.loadReleaseArtifact(input.baseReleaseId);
    const baseArtifact = loaded.artifact;

    const hasExplicitSelection =
      input.includedDraftRuleIds !== undefined ||
      input.includedDraftTopologyIds !== undefined ||
      input.includedRemovalItemIds !== undefined;

    const resolvedInput: CreateReleaseCandidateInput = {
      ...input,
      includedDraftRuleIds:
        input.includedDraftRuleIds !== undefined
          ? input.includedDraftRuleIds
          : hasExplicitSelection
            ? []
            : await this.listReadyDraftRuleRefs(),
      includedDraftTopologyIds:
        input.includedDraftTopologyIds !== undefined
          ? input.includedDraftTopologyIds
          : hasExplicitSelection
            ? []
            : [],
      includedRemovalItemIds:
        input.includedRemovalItemIds !== undefined
          ? input.includedRemovalItemIds
          : hasExplicitSelection
            ? []
            : [],
    };

    const { changes, curationEntries, curatedChangeIds } = await this.buildExplicitChanges(
      baseArtifact,
      resolvedInput,
    );

    if (changes.length === 0) {
      throw HttpError.badRequest(
        "EMPTY_CHANGESET",
        "Release candidate requires at least one explicit curated change",
      );
    }

    const manifest: AbilityCatalogReleaseManifest = {
      origin: "CURATED_RELEASE",
      curatedChangeIds,
      curationEntries,
      notes: input.notes,
    };

    const artifact = compileAbilityCatalogRelease({
      baseRules: baseArtifact.rules,
      baseTopology: baseArtifact.topology,
      changes,
      gameVersion: baseArtifact.gameVersion,
      wowBuild: input.wowBuild ?? baseArtifact.wowBuild,
      seasonSlug: baseArtifact.seasonSlug,
      previousReleaseId: input.baseReleaseId,
      manifest,
    });

    const diff = diffReleaseArtifacts({
      base: baseArtifact,
      candidate: artifact,
      curationEntries,
      compiledOps: changes,
    });

    const result = await this.persistCompiledRelease(
      {
        artifact,
        previousReleaseId: input.baseReleaseId,
        diff,
        notes: input.notes ?? null,
      },
      audit,
      { auditAction: "admin.ability_catalog.release.persisted" },
    );

    await this.audit("admin.ability_catalog.release.persisted", result.release.id, audit, {
      created: result.created,
      releaseKey: result.release.releaseKey,
      contentDigest: result.release.contentDigest,
      previousReleaseId: input.baseReleaseId,
      changeCount: changes.length,
    });

    return result;
  }

  /**
   * Persist an already-compiled artifact (tests / tooling). Never activates.
   */
  async persistCompiledRelease(
    input: PersistCompiledInput,
    audit: AbilityCatalogReleaseAuditContext,
    opts?: { auditAction?: string; forceStatus?: "VALIDATED" | "REJECTED" | "DRAFT_BUILD" },
  ): Promise<{ release: AbilityCatalogReleaseDTO; created: boolean }> {
    const validation = validateAbilityCatalogReleaseArtifact(input.artifact);
    if (input.requireParityPass) {
      const parity = compareStaticCatalogToReleaseArtifact(input.artifact);
      if (parity.overall !== "PASS") {
        throw HttpError.conflict("RELEASE_PARITY_FAILED", "Parity gate failed", {
          overall: parity.overall,
        });
      }
    }

    const semanticBytes = serializeSemanticReleaseContentBytes(input.artifact);
    const casHash = casHashOfSemanticBytes(semanticBytes);
    if (casHash !== input.artifact.contentDigest) {
      throw HttpError.conflict(
        "CAS_DIGEST_MISMATCH",
        `CAS hash ${casHash} must equal contentDigest ${input.artifact.contentDigest}`,
      );
    }

    const existing = await this.prisma.abilityCatalogRelease.findUnique({
      where: { contentDigest: input.artifact.contentDigest },
    });
    if (existing) {
      return { release: await this.getRelease(existing.id), created: false };
    }

    // CAS first (outside release row): orphan payload is acceptable if DB insert fails later.
    await this.ensureCasPayload(semanticBytes, ARTIFACT_CLASS_RELEASE);

    const validationReport = {
      validatorVersion: ABILITY_CATALOG_RELEASE_VALIDATOR_VERSION,
      schemaVersion: input.artifact.schemaVersion,
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      contentDigest: input.artifact.contentDigest,
      releaseKey: input.artifact.releaseKey,
      validatedAt: new Date().toISOString(),
    };
    const validationBytes = Buffer.from(JSON.stringify(validationReport), "utf8");
    const validationDigest = sha256Hex(validationBytes);
    await this.ensureCasPayload(validationBytes, ARTIFACT_CLASS_RELEASE_VALIDATION);

    // Bootstrap Release 0 uses the accepted durable UUID from Phase 3B.1.
    const BOOTSTRAP_RELEASE_ID = "d68793e5-7389-4cd6-b4c2-2eec96bea068";
    const releaseId =
      input.diff?.kind === "BOOTSTRAP" ? BOOTSTRAP_RELEASE_ID : randomUUID();
    const counts = topologyCounts(input.artifact.topology);
    const status =
      opts?.forceStatus ??
      (validation.valid ? ("VALIDATED" as const) : ("REJECTED" as const));
    const generatedAt = new Date(input.artifact.generatedAt);

    try {
      await this.prisma.$transaction(async (tx) => {
        const releaseArtifact = await persistInternalBytes(tx, {
          bytes: semanticBytes,
          artifactClass: ARTIFACT_CLASS_RELEASE,
          ownerType: OWNER_RELEASE,
          ownerId: releaseId,
        });
        const validationArtifact = await persistInternalBytes(tx, {
          bytes: validationBytes,
          artifactClass: ARTIFACT_CLASS_RELEASE_VALIDATION,
          ownerType: OWNER_RELEASE,
          ownerId: releaseId,
        });

        if (releaseArtifact.contentHash !== input.artifact.contentDigest) {
          throw new Error("Release CAS contentHash diverged from contentDigest");
        }

        await tx.abilityCatalogRelease.create({
          data: {
            id: releaseId,
            releaseKey: input.artifact.releaseKey,
            schemaVersion: input.artifact.schemaVersion,
            contentDigest: input.artifact.contentDigest,
            topologyDigest: input.artifact.topologyDigest,
            casContentHash: releaseArtifact.contentHash,
            gameVersion: input.artifact.gameVersion,
            wowBuild: input.artifact.wowBuild,
            seasonSlug: input.artifact.seasonSlug,
            previousReleaseId: input.previousReleaseId,
            artifactId: releaseArtifact.artifactId,
            ruleCount: input.artifact.rules.length,
            classCount: counts.classCount,
            specCount: counts.specCount,
            raceCount: counts.raceCount,
            status,
            manifest: input.artifact.manifest as unknown as Prisma.InputJsonValue,
            diff: input.diff as unknown as Prisma.InputJsonValue,
            notes: input.notes ?? null,
            generatedAt,
            createdByUserId: audit.userId,
            validatedAt: new Date(),
            validationStatus: validation.valid ? "PASS" : "FAIL",
            validationErrorCount: validation.errors.length,
            validationWarningCount: validation.warnings.length,
            validationReportDigest: validationDigest,
            validationReportArtifactId: validationArtifact.artifactId,
            validatorVersion: ABILITY_CATALOG_RELEASE_VALIDATOR_VERSION,
          },
        });
      });
    } catch (err) {
      const prismaErr = err as { code?: string };
      if (prismaErr.code === "P2002") {
        const raced = await this.prisma.abilityCatalogRelease.findUnique({
          where: { contentDigest: input.artifact.contentDigest },
        });
        if (raced) {
          return { release: await this.getRelease(raced.id), created: false };
        }
      }
      throw err;
    }

    if (opts?.auditAction) {
      // caller may also audit
    }

    return { release: await this.getRelease(releaseId), created: true };
  }

  async loadReleaseArtifact(releaseId: string): Promise<{
    release: AbilityCatalogReleaseDTO;
    artifact: AbilityCatalogReleaseArtifact;
    casBytes: Buffer;
  }> {
    const row = await this.prisma.abilityCatalogRelease.findUnique({ where: { id: releaseId } });
    if (!row) {
      throw HttpError.notFound("RELEASE_NOT_FOUND", "Ability catalog release was not found");
    }

    const payload = await this.prisma.rawArtifactPayload.findUnique({
      where: { contentHash: row.casContentHash },
    });
    if (!payload) {
      throw HttpError.conflict(
        "RELEASE_CAS_MISSING",
        "Release CAS payload is missing; fail closed (no static fallback)",
      );
    }

    const casBytes = Buffer.from(payload.payload);
    const actualHash = sha256Hex(casBytes);
    if (actualHash !== row.casContentHash) {
      throw HttpError.conflict(
        "RELEASE_CAS_CORRUPT",
        "CAS payload bytes do not match stored casContentHash",
      );
    }

    const artifact = artifactFromSemanticContentBytes(casBytes, row.generatedAt.toISOString());

    if (artifact.contentDigest !== row.contentDigest) {
      throw HttpError.conflict(
        "RELEASE_CONTENT_DIGEST_MISMATCH",
        "Recomputed contentDigest does not match DB metadata",
      );
    }
    if (artifact.releaseKey !== row.releaseKey) {
      throw HttpError.conflict(
        "RELEASE_KEY_MISMATCH",
        "Recomputed releaseKey does not match DB metadata",
      );
    }
    if (artifact.topologyDigest !== row.topologyDigest) {
      throw HttpError.conflict(
        "RELEASE_TOPOLOGY_DIGEST_MISMATCH",
        "Recomputed topologyDigest does not match DB metadata",
      );
    }
    if (artifact.schemaVersion !== row.schemaVersion) {
      throw HttpError.conflict(
        "RELEASE_SCHEMA_MISMATCH",
        "Artifact schemaVersion does not match DB metadata",
      );
    }
    if (artifact.schemaVersion !== ABILITY_CATALOG_RELEASE_SCHEMA_V1) {
      throw HttpError.conflict("UNSUPPORTED_RELEASE_SCHEMA", "Unsupported release schema");
    }

    const validation = validateAbilityCatalogReleaseArtifact(artifact);
    if (!validation.valid && row.status === "VALIDATED") {
      // still return artifact but surface via validate endpoint; load itself verifies integrity
    }

    return { release: toReleaseDto(row), artifact, casBytes };
  }

  async revalidateRelease(
    releaseId: string,
    audit: AbilityCatalogReleaseAuditContext,
  ): Promise<{
    release: AbilityCatalogReleaseDTO;
    validation: ReturnType<typeof validateAbilityCatalogReleaseArtifact>;
    validatorVersion: string;
  }> {
    const { release, artifact } = await this.loadReleaseArtifact(releaseId);
    const validation = validateAbilityCatalogReleaseArtifact(artifact);
    const validationReport = {
      validatorVersion: ABILITY_CATALOG_RELEASE_VALIDATOR_VERSION,
      schemaVersion: artifact.schemaVersion,
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      contentDigest: artifact.contentDigest,
      releaseKey: artifact.releaseKey,
      validatedAt: new Date().toISOString(),
      revalidation: true,
    };
    const validationBytes = Buffer.from(JSON.stringify(validationReport), "utf8");
    const validationDigest = sha256Hex(validationBytes);

    await this.ensureCasPayload(validationBytes, ARTIFACT_CLASS_RELEASE_VALIDATION);

    await this.prisma.$transaction(async (tx) => {
      const validationArtifact = await persistInternalBytes(tx, {
        bytes: validationBytes,
        artifactClass: ARTIFACT_CLASS_RELEASE_VALIDATION,
        ownerType: OWNER_RELEASE,
        ownerId: releaseId,
      });
      await tx.abilityCatalogRelease.update({
        where: { id: releaseId },
        data: {
          validatedAt: new Date(),
          validationStatus: validation.valid ? "PASS" : "FAIL",
          validationErrorCount: validation.errors.length,
          validationWarningCount: validation.warnings.length,
          validationReportDigest: validationDigest,
          validationReportArtifactId: validationArtifact.artifactId,
          validatorVersion: ABILITY_CATALOG_RELEASE_VALIDATOR_VERSION,
          // Semantic fields intentionally untouched. Status: VALIDATED stays if still pass;
          // if fail, mark REJECTED without touching ACTIVE (never set here).
          ...(validation.valid
            ? release.status === "REJECTED"
              ? { status: "VALIDATED" as const }
              : {}
            : release.status !== "ACTIVE" && release.status !== "SUPERSEDED"
              ? { status: "REJECTED" as const }
              : {}),
        },
      });
    });

    await this.audit(
      validation.valid
        ? "admin.ability_catalog.release.validate"
        : "admin.ability_catalog.release.validate_failed",
      releaseId,
      audit,
      {
        valid: validation.valid,
        errorCount: validation.errors.length,
        warningCount: validation.warnings.length,
        validatorVersion: ABILITY_CATALOG_RELEASE_VALIDATOR_VERSION,
      },
    );

    return {
      release: await this.getRelease(releaseId),
      validation,
      validatorVersion: ABILITY_CATALOG_RELEASE_VALIDATOR_VERSION,
    };
  }

  async listReleases(): Promise<{ releases: AbilityCatalogReleaseDTO[] }> {
    const rows = await this.prisma.abilityCatalogRelease.findMany({
      orderBy: { createdAt: "desc" },
    });
    return { releases: rows.map(toReleaseDto) };
  }

  async getRelease(id: string): Promise<AbilityCatalogReleaseDTO> {
    const row = await this.prisma.abilityCatalogRelease.findUnique({ where: { id } });
    if (!row) {
      throw HttpError.notFound("RELEASE_NOT_FOUND", "Ability catalog release was not found");
    }
    return toReleaseDto(row);
  }

  async getArtifactSummary(id: string): Promise<{
    release: AbilityCatalogReleaseDTO;
    artifactSummary: {
      schemaVersion: string;
      releaseKey: string;
      contentDigest: string;
      topologyDigest: string;
      ruleCount: number;
      classCount: number;
      specCount: number;
      raceCount: number;
      manifestOrigin: string;
      casContentHash: string;
      casByteLength: number;
    };
  }> {
    const { release, artifact, casBytes } = await this.loadReleaseArtifact(id);
    const counts = topologyCounts(artifact.topology);
    return {
      release,
      artifactSummary: {
        schemaVersion: artifact.schemaVersion,
        releaseKey: artifact.releaseKey,
        contentDigest: artifact.contentDigest,
        topologyDigest: artifact.topologyDigest,
        ruleCount: artifact.rules.length,
        classCount: counts.classCount,
        specCount: counts.specCount,
        raceCount: counts.raceCount,
        manifestOrigin: artifact.manifest.origin,
        casContentHash: release.casContentHash,
        casByteLength: casBytes.byteLength,
      },
    };
  }

  private async ensureCasPayload(bytes: Buffer, artifactClass: string): Promise<string> {
    const contentHash = sha256Hex(bytes);
    const size = BigInt(bytes.byteLength);
    const existing = await this.prisma.rawArtifactPayload.findUnique({ where: { contentHash } });
    if (!existing) {
      await this.prisma.rawArtifactPayload.create({
        data: {
          contentHash,
          compression: "NONE",
          payload: new Uint8Array(bytes),
          compressedSizeBytes: size,
          uncompressedSizeBytes: size,
        },
      });
    }
    await this.prisma.rawArtifact.upsert({
      where: { contentHash },
      create: {
        id: randomUUID(),
        provider: "INTERNAL",
        storageUri: `pg://sha256/${contentHash}`,
        compression: "NONE",
        contentHash,
        sizeBytes: size,
        uncompressedSizeBytes: size,
        artifactClass,
        refCount: 0,
      },
      update: {
        artifactClass,
        sizeBytes: size,
        uncompressedSizeBytes: size,
      },
    });
    return contentHash;
  }

  private async buildExplicitChanges(
    baseArtifact: AbilityCatalogReleaseArtifact,
    input: CreateReleaseCandidateInput,
  ): Promise<{
    changes: CompiledCatalogChange[];
    curationEntries: ReleaseCurationEntry[];
    curatedChangeIds: string[];
  }> {
    const changes: CompiledCatalogChange[] = [];
    const curationEntries: ReleaseCurationEntry[] = [];
    const curatedChangeIds: string[] = [];
    const touchedKeys = new Set<string>();

    const draftRuleRefs = input.includedDraftRuleIds ?? [];
    for (const ref of draftRuleRefs) {
      const draft = await this.prisma.abilityCatalogDraftRule.findUnique({
        where: { id: ref.draftRuleId },
        include: {
          reviewItem: {
            include: {
              batch: true,
              decisionEvents: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
      });
      if (!draft) {
        throw HttpError.badRequest("DRAFT_RULE_NOT_FOUND", `Draft rule ${ref.draftRuleId} not found`);
      }
      if (draft.version !== ref.draftVersion) {
        throw HttpError.badRequest(
          "DRAFT_VERSION_MISMATCH",
          `Draft rule ${ref.draftRuleId} version mismatch: expected ${ref.draftVersion}, got ${draft.version}`,
        );
      }
      if (draft.status !== "READY_FOR_PUBLISH_REVIEW") {
        throw HttpError.badRequest(
          "DRAFT_NOT_READY",
          `Draft rule ${ref.draftRuleId} status is ${draft.status}; only READY_FOR_PUBLISH_REVIEW may be included`,
        );
      }

      if (draft.source === "MANUAL" || !draft.reviewItem) {
        if (!draft.canonicalKey) {
          throw HttpError.badRequest(
            "DRAFT_MISSING_CANONICAL_KEY",
            `Manual draft ${ref.draftRuleId} missing canonicalKey`,
          );
        }
        const exists = baseArtifact.rules.some((r) => r.canonicalKey === draft.canonicalKey);
        if (!exists) {
          throw HttpError.badRequest(
            "MANUAL_EDIT_KEY_MISSING",
            `Manual edit canonicalKey ${draft.canonicalKey} not in base release`,
          );
        }
        const rule = draftRuleRowToAbilityRule(draft, { topology: baseArtifact.topology });
        if (touchedKeys.has(rule.canonicalKey)) {
          throw HttpError.badRequest(
            "CONTRADICTORY_CHANGESET",
            `Duplicate operations on canonicalKey ${rule.canonicalKey}`,
          );
        }
        touchedKeys.add(rule.canonicalKey);
        changes.push({ op: "UPDATE_RULE", canonicalKey: rule.canonicalKey, rule });
        curationEntries.push({
          operation: "UPDATE_RULE",
          canonicalKey: rule.canonicalKey,
          draftRuleId: draft.id,
          draftVersion: draft.version,
          actorUserId: draft.createdByUserId,
        });
        curatedChangeIds.push(draft.id);
        continue;
      }

      const kind = draft.reviewItem.kind;
      if (kind !== "NEW_ABILITY_CANDIDATE" && kind !== "SPELL_BINDING_REVIEW") {
        throw HttpError.badRequest(
          "DRAFT_KIND_MISMATCH",
          `Draft rule ${ref.draftRuleId} review kind ${kind} cannot produce a rule change`,
        );
      }
      const action = draft.reviewItem.decisionAction;
      const allowed =
        kind === "NEW_ABILITY_CANDIDATE"
          ? action === "ACCEPT"
          : action === "ACCEPT_PROPOSED" || action === "KEEP_CURRENT";
      if (!allowed) {
        throw HttpError.badRequest(
          "DRAFT_DECISION_NOT_ALLOWED",
          `Draft rule ${ref.draftRuleId} decision ${String(action)} does not allow compile`,
        );
      }

      const rule = draftRuleRowToAbilityRule(draft, { topology: baseArtifact.topology });
      if (touchedKeys.has(rule.canonicalKey)) {
        throw HttpError.badRequest(
          "CONTRADICTORY_CHANGESET",
          `Duplicate operations on canonicalKey ${rule.canonicalKey}`,
        );
      }
      touchedKeys.add(rule.canonicalKey);

      const exists = baseArtifact.rules.some((r) => r.canonicalKey === rule.canonicalKey);
      const op = exists ? ("UPDATE_RULE" as const) : ("ADD_RULE" as const);
      changes.push(
        exists
          ? { op: "UPDATE_RULE", canonicalKey: rule.canonicalKey, rule }
          : { op: "ADD_RULE", rule },
      );

      const entry: ReleaseCurationEntry = {
        operation: op,
        canonicalKey: rule.canonicalKey,
        reviewBatchId: draft.reviewItem.batchId,
        reviewItemId: draft.reviewItemId ?? undefined,
        draftRuleId: draft.id,
        decisionEventId: draft.reviewItem.decisionEvents[0]?.id,
        draftVersion: draft.version,
        actorUserId: draft.reviewItem.decidedByUserId,
        sourceReportDigest: draft.reviewItem.batch.reportDigest,
      };
      curationEntries.push(entry);
      curatedChangeIds.push(draft.id);
    }

    let topologyWorking: ReleaseTopology | null = null;
    for (const ref of input.includedDraftTopologyIds ?? []) {
      const draft = await this.prisma.abilityCatalogDraftTopology.findUnique({
        where: { id: ref.draftTopologyId },
        include: {
          reviewItem: {
            include: {
              batch: true,
              decisionEvents: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
      });
      if (!draft) {
        throw HttpError.badRequest(
          "DRAFT_TOPOLOGY_NOT_FOUND",
          `Draft topology ${ref.draftTopologyId} not found`,
        );
      }
      if (draft.version !== ref.draftVersion) {
        throw HttpError.badRequest(
          "DRAFT_VERSION_MISMATCH",
          `Draft topology ${ref.draftTopologyId} version mismatch`,
        );
      }
      if (draft.reviewItem.kind !== "TOPOLOGY_REVIEW") {
        throw HttpError.badRequest("DRAFT_KIND_MISMATCH", "Topology draft kind mismatch");
      }
      if (draft.reviewItem.decisionAction !== "ACCEPT") {
        throw HttpError.badRequest(
          "DRAFT_DECISION_NOT_ALLOWED",
          `Topology draft decision ${String(draft.reviewItem.decisionAction)} not allowed`,
        );
      }
      // Topology drafts use status string; require ACCEPTED or READY-like
      if (draft.status !== "ACCEPTED" && draft.status !== "READY_FOR_PUBLISH_REVIEW") {
        throw HttpError.badRequest(
          "DRAFT_NOT_READY",
          `Topology draft ${ref.draftTopologyId} status is ${draft.status}`,
        );
      }

      topologyWorking = applyTopologyDraft(topologyWorking ?? baseArtifact.topology, draft);
      curationEntries.push({
        operation: "UPDATE_TOPOLOGY",
        reviewBatchId: draft.reviewItem.batchId,
        reviewItemId: draft.reviewItemId ?? undefined,
        draftTopologyId: draft.id,
        decisionEventId: draft.reviewItem.decisionEvents[0]?.id,
        draftVersion: draft.version,
        actorUserId: draft.reviewItem.decidedByUserId,
        sourceReportDigest: draft.reviewItem.batch.reportDigest,
      });
      curatedChangeIds.push(draft.id);
    }
    if (topologyWorking) {
      changes.push({ op: "UPDATE_TOPOLOGY", topology: topologyWorking });
    }

    for (const ref of input.includedRemovalItemIds ?? []) {
      const item = await this.prisma.abilityCatalogReviewItem.findUnique({
        where: { id: ref.reviewItemId },
        include: {
          batch: true,
          decisionEvents: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
      if (!item) {
        throw HttpError.badRequest("REMOVAL_ITEM_NOT_FOUND", `Review item ${ref.reviewItemId} not found`);
      }
      if (item.kind !== "REMOVAL_REVIEW") {
        throw HttpError.badRequest("DRAFT_KIND_MISMATCH", "Removal item is not REMOVAL_REVIEW");
      }
      if (item.decisionAction !== "CONFIRM_REMOVAL") {
        throw HttpError.badRequest(
          "DRAFT_DECISION_NOT_ALLOWED",
          `Removal item decision ${String(item.decisionAction)} not allowed`,
        );
      }
      const key = item.matchedCanonicalKey;
      if (!key) {
        throw HttpError.badRequest("REMOVAL_MISSING_KEY", "Removal item missing matchedCanonicalKey");
      }
      if (touchedKeys.has(key)) {
        throw HttpError.badRequest("CONTRADICTORY_CHANGESET", `Duplicate operations on ${key}`);
      }
      touchedKeys.add(key);
      if (!baseArtifact.rules.some((r) => r.canonicalKey === key)) {
        throw HttpError.badRequest("REMOVAL_KEY_MISSING", `canonicalKey ${key} not in base release`);
      }
      changes.push({ op: "TOMBSTONE_RULE", canonicalKey: key, validToBuild: ref.validToBuild });
      curationEntries.push({
        operation: "TOMBSTONE_RULE",
        canonicalKey: key,
        reviewBatchId: item.batchId,
        reviewItemId: item.id,
        decisionEventId: ref.decisionEventId ?? item.decisionEvents[0]?.id,
        actorUserId: item.decidedByUserId,
        sourceReportDigest: item.batch.reportDigest,
      });
      curatedChangeIds.push(item.id);
    }

    const pendingTombstones = await listCanonicalKeysPendingExclusionTombstone(
      this.prisma,
      baseArtifact.rules.map((rule) => rule.canonicalKey),
    );
    const validToBuild = input.wowBuild ?? baseArtifact.wowBuild ?? "0";
    for (const key of pendingTombstones) {
      if (touchedKeys.has(key)) continue;
      if (!baseArtifact.rules.some((rule) => rule.canonicalKey === key)) continue;
      touchedKeys.add(key);
      changes.push({ op: "TOMBSTONE_RULE", canonicalKey: key, validToBuild });
      curationEntries.push({
        operation: "TOMBSTONE_RULE",
        canonicalKey: key,
        actorUserId: null,
        sourceReportDigest: null,
      });
    }

    return { changes, curationEntries, curatedChangeIds: [...new Set(curatedChangeIds)].sort() };
  }

  private async listReadyDraftRuleRefs(): Promise<IncludedDraftRuleRef[]> {
    const rows = await this.prisma.abilityCatalogDraftRule.findMany({
      where: { status: "READY_FOR_PUBLISH_REVIEW" },
      select: { id: true, version: true },
      orderBy: { canonicalKey: "asc" },
    });
    return rows.map((row) => ({ draftRuleId: row.id, draftVersion: row.version }));
  }

  private async audit(
    action: string,
    resourceId: string,
    ctx: AbilityCatalogReleaseAuditContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditEvent(this.prisma, {
      userId: ctx.userId,
      actorType: ctx.actorType,
      action,
      resourceType: "ability_catalog_release",
      resourceId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      sessionSecret: ctx.sessionSecret,
      metadata,
    });
  }
}

export type AbilityCatalogReleaseDTO = {
  id: string;
  releaseKey: string;
  schemaVersion: string;
  contentDigest: string;
  topologyDigest: string;
  casContentHash: string;
  gameVersion: string;
  wowBuild: string;
  seasonSlug: string;
  previousReleaseId: string | null;
  artifactId: string;
  ruleCount: number;
  classCount: number;
  specCount: number;
  raceCount: number;
  status: string;
  manifest: unknown;
  diff: unknown;
  notes: string | null;
  generatedAt: string;
  createdAt: string;
  createdByUserId: string | null;
  validatedAt: string | null;
  validationStatus: string | null;
  validationErrorCount: number | null;
  validationWarningCount: number | null;
  validationReportDigest: string | null;
  validationReportArtifactId: string | null;
  validatorVersion: string | null;
  publishedAt: string | null;
};

function toReleaseDto(row: {
  id: string;
  releaseKey: string;
  schemaVersion: string;
  contentDigest: string;
  topologyDigest: string;
  casContentHash: string;
  gameVersion: string;
  wowBuild: string;
  seasonSlug: string;
  previousReleaseId: string | null;
  artifactId: string;
  ruleCount: number;
  classCount: number;
  specCount: number;
  raceCount: number;
  status: string;
  manifest: unknown;
  diff: unknown;
  notes: string | null;
  generatedAt: Date;
  createdAt: Date;
  createdByUserId: string | null;
  validatedAt: Date | null;
  validationStatus: string | null;
  validationErrorCount: number | null;
  validationWarningCount: number | null;
  validationReportDigest: string | null;
  validationReportArtifactId: string | null;
  validatorVersion: string | null;
  publishedAt?: Date | null;
}): AbilityCatalogReleaseDTO {
  return {
    id: row.id,
    releaseKey: row.releaseKey,
    schemaVersion: row.schemaVersion,
    contentDigest: row.contentDigest,
    topologyDigest: row.topologyDigest,
    casContentHash: row.casContentHash,
    gameVersion: row.gameVersion,
    wowBuild: row.wowBuild,
    seasonSlug: row.seasonSlug,
    previousReleaseId: row.previousReleaseId,
    artifactId: row.artifactId,
    ruleCount: row.ruleCount,
    classCount: row.classCount,
    specCount: row.specCount,
    raceCount: row.raceCount,
    status: row.status,
    manifest: row.manifest,
    diff: row.diff,
    notes: row.notes,
    generatedAt: row.generatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    validationStatus: row.validationStatus,
    validationErrorCount: row.validationErrorCount,
    validationWarningCount: row.validationWarningCount,
    validationReportDigest: row.validationReportDigest,
    validationReportArtifactId: row.validationReportArtifactId,
    validatorVersion: row.validatorVersion,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}
