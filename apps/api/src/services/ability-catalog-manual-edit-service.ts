import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@mplus/database";
import type {
  AbilityCatalogDraftValidationDTO,
  ManualCatalogEditDetail,
  ManualCatalogEditSummary,
  SaveManualCatalogEditRequest,
} from "@mplus/contracts";
import {
  saveManualCatalogEditRequestSchema,
  firstZodIssueMessage,
} from "@mplus/contracts";
import type { ZodType } from "zod";
import type { AbilityRule, CuratedDraftRuleInput } from "@mplus/abilities";
import {
  dimensionTagsForRule,
  projectCurrentRuleBindings,
  validateCuratedDraftRule,
} from "@mplus/abilities";
import { HttpError } from "../errors.js";
import { writeAuditEvent } from "../iam/audit.js";
import {
  AbilityCatalogReleaseActivationService,
} from "./ability-catalog-release-activation-service.js";
import { AbilityCatalogReleaseService } from "./ability-catalog-release-service.js";

export type ManualCatalogEditAuditContext = {
  userId: string | null;
  actorType: "user" | "admin_key" | "system" | "anonymous";
  ip?: string | null;
  userAgent?: string | null;
  sessionSecret: string;
};

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw HttpError.badRequest("VALIDATION_FAILED", firstZodIssueMessage(parsed.error));
  }
  return parsed.data;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function catalogRuleToCuratedDraftInput(rule: AbilityRule): CuratedDraftRuleInput {
  const bindings = projectCurrentRuleBindings(rule).map((binding) => ({
    spellId: binding.spellId,
    role: binding.role,
  }));
  const spellIdSet = new Set<number>(rule.spellIds);
  for (const binding of bindings) spellIdSet.add(binding.spellId);
  const spellIds = [...spellIdSet].sort((a, b) => a - b);
  return {
    canonicalKey: rule.canonicalKey,
    name: rule.name,
    spellIds,
    bindings,
    iconName: rule.iconName ?? null,
    classSlug: rule.classSlug,
    specSlugs: [...rule.specSlugs],
    raceSlugs: [...(rule.raceSlugs ?? [])],
    category: rule.category,
    dimensionTags: dimensionTagsForRule(rule),
    availability: rule.availability,
    cooldownSeconds: rule.cooldownSeconds ?? null,
    charges: rule.charges ?? null,
    sourceOwnership: rule.sourceOwnership,
    provenance: { ...rule.provenance } as Record<string, unknown>,
    validityBuild: rule.validFromBuild ?? null,
    validFromBuild: rule.validFromBuild ?? null,
    validToBuild: rule.validToBuild ?? null,
    notes: rule.provenance.notes ?? null,
  };
}

function draftPersistData(
  draft: CuratedDraftRuleInput,
  status: "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW",
) {
  const validFrom = draft.validFromBuild ?? draft.validityBuild ?? null;
  const provenance = {
    ...(draft.provenance ?? {}),
    ...(draft.validToBuild ? { validToBuild: draft.validToBuild } : {}),
    ...(validFrom ? { validFromBuild: validFrom } : {}),
  };
  return {
    canonicalKey: draft.canonicalKey ?? null,
    name: draft.name,
    spellIds: draft.spellIds as Prisma.InputJsonValue,
    bindings: draft.bindings as Prisma.InputJsonValue,
    iconName: draft.iconName ?? null,
    classSlug: draft.classSlug ?? null,
    specSlugs: (draft.specSlugs ?? []) as Prisma.InputJsonValue,
    raceSlugs: (draft.raceSlugs ?? []) as Prisma.InputJsonValue,
    category: draft.category ?? null,
    dimensionTags: (draft.dimensionTags ?? []) as Prisma.InputJsonValue,
    availability: draft.availability ?? null,
    cooldownSeconds: draft.cooldownSeconds ?? null,
    charges: draft.charges ?? null,
    sourceOwnership: draft.sourceOwnership ?? null,
    provenance: provenance as Prisma.InputJsonValue,
    validityBuild: validFrom,
    notes: draft.notes ?? null,
    status,
  };
}

function curatedDraftFromRequest(
  canonicalKey: string,
  draft: SaveManualCatalogEditRequest["draft"],
  fallback: CuratedDraftRuleInput,
): CuratedDraftRuleInput {
  const bindings =
    draft.bindings && draft.bindings.length > 0 ? draft.bindings : fallback.bindings;
  const spellIds =
    draft.spellIds?.length
      ? draft.spellIds
      : fallback.spellIds.length
        ? fallback.spellIds
        : bindings.map((b) => b.spellId);
  return {
    canonicalKey,
    name: draft.name ?? fallback.name,
    spellIds,
    bindings,
    iconName: draft.iconName ?? fallback.iconName ?? null,
    classSlug: draft.classSlug ?? fallback.classSlug ?? null,
    specSlugs: draft.specSlugs ?? fallback.specSlugs ?? [],
    raceSlugs: draft.raceSlugs ?? fallback.raceSlugs ?? [],
    category: draft.category ?? fallback.category ?? null,
    dimensionTags: draft.dimensionTags ?? fallback.dimensionTags ?? [],
    availability: draft.availability ?? fallback.availability ?? null,
    cooldownSeconds: draft.cooldownSeconds ?? fallback.cooldownSeconds ?? null,
    charges: draft.charges ?? fallback.charges ?? null,
    sourceOwnership: draft.sourceOwnership ?? fallback.sourceOwnership ?? null,
    provenance: {
      ...(fallback.provenance ?? {}),
      ...(draft.provenance ?? {}),
    },
    validityBuild: draft.validFromBuild ?? fallback.validityBuild ?? null,
    validFromBuild: draft.validFromBuild ?? fallback.validFromBuild ?? null,
    validToBuild: draft.validToBuild ?? fallback.validToBuild ?? null,
    notes: draft.notes ?? fallback.notes ?? null,
  };
}

function draftRowToPayload(row: {
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
  notes: string | null;
}) {
  const provenance =
    row.provenance && typeof row.provenance === "object" && !Array.isArray(row.provenance)
      ? (row.provenance as Record<string, unknown>)
      : {};
  return {
    canonicalKey: row.canonicalKey,
    name: row.name,
    spellIds: asNumberArray(row.spellIds),
    bindings: row.bindings,
    iconName: row.iconName,
    classSlug: row.classSlug,
    specSlugs: asStringArray(row.specSlugs),
    raceSlugs: asStringArray(row.raceSlugs),
    category: row.category,
    dimensionTags: asStringArray(row.dimensionTags),
    availability: row.availability,
    cooldownSeconds: row.cooldownSeconds,
    charges: row.charges,
    sourceOwnership: row.sourceOwnership,
    provenance,
    validFromBuild: row.validityBuild ?? provenance.validFromBuild ?? null,
    validToBuild: typeof provenance.validToBuild === "string" ? provenance.validToBuild : null,
    notes: row.notes,
  };
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function validationDto(
  validation: ReturnType<typeof validateCuratedDraftRule>,
): AbilityCatalogDraftValidationDTO {
  return {
    status: validation.status,
    readyForPublishReview: validation.readyForPublishReview,
    reasonCodes: validation.reasonCodes,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

export class AbilityCatalogManualEditService {
  private readonly releases: AbilityCatalogReleaseService;
  private readonly activation: AbilityCatalogReleaseActivationService;

  constructor(private readonly prisma: PrismaClient) {
    this.releases = new AbilityCatalogReleaseService(prisma);
    this.activation = new AbilityCatalogReleaseActivationService(prisma);
  }

  async listPendingEdits(): Promise<{ edits: ManualCatalogEditSummary[] }> {
    const rows = await this.prisma.abilityCatalogDraftRule.findMany({
      where: { source: "MANUAL" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        canonicalKey: true,
        name: true,
        version: true,
        status: true,
      },
    });
    return {
      edits: rows
        .filter((row) => row.canonicalKey)
        .map((row) => ({
          canonicalKey: row.canonicalKey!,
          draftRuleId: row.id,
          version: row.version,
          status: row.status,
          name: row.name,
        })),
    };
  }

  async getEdit(canonicalKey: string): Promise<ManualCatalogEditDetail> {
    const activeRule = await this.loadActiveRule(canonicalKey);
    const prefill = catalogRuleToCuratedDraftInput(activeRule);
    const existing = await this.findManualDraft(canonicalKey);
    if (!existing) {
      return {
        canonicalKey,
        activeRule,
        draft: prefill,
        draftRuleId: null,
        draftVersion: null,
        draftStatus: null,
        draftValidation: validationDto(
          validateCuratedDraftRule(prefill, {
            existingCanonicalKeys: new Set(),
            otherDraftCanonicalKeys: new Set(),
          }),
        ),
      };
    }
    const draftPayload = draftRowToPayload(existing);
    const validation = validateCuratedDraftRule(draftPayload as CuratedDraftRuleInput, {
      existingCanonicalKeys: new Set(),
      otherDraftCanonicalKeys: new Set(),
    });
    return {
      canonicalKey,
      activeRule,
      draft: draftPayload,
      draftRuleId: existing.id,
      draftVersion: existing.version,
      draftStatus: existing.status,
      draftValidation: validationDto(validation),
    };
  }

  async saveEdit(
    canonicalKey: string,
    body: unknown,
    audit: ManualCatalogEditAuditContext,
  ): Promise<ManualCatalogEditDetail> {
    const input = parseBody(saveManualCatalogEditRequestSchema, body);
    const activeRule = await this.loadActiveRule(canonicalKey);
    const prefill = catalogRuleToCuratedDraftInput(activeRule);
    const draftInput = curatedDraftFromRequest(canonicalKey, input.draft, prefill);

    const otherManualKeys = await this.prisma.abilityCatalogDraftRule.findMany({
      where: { source: "MANUAL", NOT: { canonicalKey } },
      select: { canonicalKey: true },
    });
    const otherDraftKeys = new Set(
      otherManualKeys.map((row) => row.canonicalKey).filter((k): k is string => Boolean(k)),
    );
    const validation = validateCuratedDraftRule(draftInput, {
      existingCanonicalKeys: new Set(),
      otherDraftCanonicalKeys: otherDraftKeys,
    });
    const blocking = validation.errors.filter((e) => e.code !== "CANONICAL_KEY_COLLISION");
    if (blocking.length > 0) {
      throw HttpError.badRequest("DRAFT_VALIDATION_FAILED", blocking[0]!.message, validation);
    }

    const existing = await this.findManualDraft(canonicalKey);
    if (existing) {
      if (input.expectedVersion == null || input.expectedVersion !== existing.version) {
        throw HttpError.conflict(
          "MANUAL_EDIT_VERSION_CONFLICT",
          "Manual edit was updated by another admin; reload and retry",
          { expectedVersion: input.expectedVersion, currentVersion: existing.version },
        );
      }
      await this.prisma.abilityCatalogDraftRule.update({
        where: { id: existing.id, version: existing.version },
        data: {
          ...draftPersistData(draftInput, validation.status),
          version: { increment: 1 },
        },
      });
    } else {
      if (input.expectedVersion != null) {
        throw HttpError.badRequest(
          "MANUAL_EDIT_NOT_FOUND",
          "No manual edit exists for this rule; omit expectedVersion to create one",
        );
      }
      await this.prisma.abilityCatalogDraftRule.create({
        data: {
          id: randomUUID(),
          source: "MANUAL",
          reviewItemId: null,
          createdByUserId: audit.userId ?? null,
          ...draftPersistData(draftInput, validation.status),
        },
      });
    }

    await this.audit("admin.ability_catalog.manual_edit.saved", canonicalKey, audit, {
      canonicalKey,
      status: validation.status,
      note: input.note ?? null,
    });

    return this.getEdit(canonicalKey);
  }

  async discardEdit(
    canonicalKey: string,
    audit: ManualCatalogEditAuditContext,
  ): Promise<{ discarded: true }> {
    const existing = await this.findManualDraft(canonicalKey);
    if (!existing) {
      return { discarded: true };
    }
    await this.prisma.abilityCatalogDraftRule.delete({ where: { id: existing.id } });
    await this.audit("admin.ability_catalog.manual_edit.discarded", canonicalKey, audit, {
      canonicalKey,
      draftRuleId: existing.id,
    });
    return { discarded: true };
  }

  private async findManualDraft(canonicalKey: string) {
    return this.prisma.abilityCatalogDraftRule.findFirst({
      where: { source: "MANUAL", canonicalKey },
    });
  }

  private async loadActiveRule(canonicalKey: string): Promise<AbilityRule> {
    const active = await this.activation.getActiveRelease();
    if (!active) {
      throw HttpError.conflict(
        "NO_ACTIVE_RELEASE",
        "No ACTIVE ability catalog release; activate a release before manual edits",
      );
    }
    const loaded = await this.releases.loadReleaseArtifact(active.id);
    const rule = loaded.artifact.rules.find((r) => r.canonicalKey === canonicalKey);
    if (!rule) {
      throw HttpError.notFound(
        "ACTIVE_RULE_NOT_FOUND",
        `Ability rule ${canonicalKey} is not in the ACTIVE catalog release`,
      );
    }
    return rule;
  }

  private async audit(
    action: string,
    resourceId: string,
    audit: ManualCatalogEditAuditContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditEvent(this.prisma, {
      userId: audit.userId,
      actorType: audit.actorType,
      action,
      resourceType: "ability_catalog_manual_edit",
      resourceId,
      ip: audit.ip,
      userAgent: audit.userAgent,
      sessionSecret: audit.sessionSecret,
      metadata,
    });
  }
}
