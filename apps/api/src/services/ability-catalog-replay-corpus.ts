/**
 * Deterministic representative corpus selection from CharacterRunDigest rows.
 * Prefer native v4 nested digests; when missing, derive v4 from frozen WclRunRaw.
 */

import { createHash } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import {
  assertParticipantScoringDigestV1,
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  type ParticipantScoringDigestV1,
} from "@mplus/contracts";
import {
  createStaticAbilityCatalogContext,
  canonicalizeRetailClassSpecIdentity,
  normalizeRetailClassSlug,
  normalizeRetailSpecSlug,
  type AbilityCatalogContext,
} from "@mplus/abilities";
import { stableStringify } from "@mplus/abilities/release";
import { deriveV4ParticipantDigestFromFrozenRaw } from "./ability-catalog-replay-derive.js";
import type { AbilityCatalogReplayCorpusSelectionMeta } from "./ability-catalog-replay-types.js";

export type CorpusSpecCoverageStatus =
  | "AVAILABLE_NATIVE_V4"
  | "DERIVED_FROM_FROZEN_EVIDENCE"
  | "MISSING_CORPUS_EVIDENCE"
  | "UNSUPPORTED_SCHEMA";

export type ReplayCorpusCandidate = {
  digestRowId: string;
  digest: ParticipantScoringDigestV1;
  classSlugNorm: string | null;
  specSlugNorm: string | null;
  role: string | null;
  coverageStatus: "AVAILABLE_NATIVE_V4" | "DERIVED_FROM_FROZEN_EVIDENCE";
  /** Present when derived; references immutable WclRunRaw id. */
  derivedFromRawRunId?: string;
};

export type CorpusSelectResult = {
  available: ReplayCorpusCandidate[];
  selected: ReplayCorpusCandidate[];
  unsupportedSchemaCount: number;
  corruptCount: number;
  meta: AbilityCatalogReplayCorpusSelectionMeta;
  corpusDigest: string;
};

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function roleOf(
  classSlug: string | null,
  specSlug: string | null,
  digestRole: string | null | undefined,
  catalog: AbilityCatalogContext,
): string | null {
  if (digestRole === "TANK" || digestRole === "HEALER" || digestRole === "DPS") {
    return digestRole;
  }
  if (!classSlug || !specSlug) return null;
  const cls = catalog.topology().classes.find((c) => c.slug === classSlug);
  const spec = cls?.specs.find((s) => s.slug === specSlug);
  return spec?.role ?? null;
}

function collectSpellIds(digest: ParticipantScoringDigestV1): number[] {
  const ids = new Set<number>();
  for (const a of digest.utility.actions) {
    ids.add(a.primarySpellId);
    for (const id of a.observedSpellIds ?? []) ids.add(id);
  }
  for (const a of digest.performance.offensiveActivations) {
    ids.add(a.primarySpellId);
    for (const id of a.observedSpellIds ?? []) ids.add(id);
  }
  for (const a of [
    ...digest.survival.personalDefensiveActivations,
    ...digest.survival.recoveryActivations,
  ]) {
    ids.add(a.primarySpellId);
    for (const id of a.observedSpellIds ?? []) ids.add(id);
  }
  return [...ids];
}

function tryParseNestedDigest(sourceMetadata: unknown): {
  digest: ParticipantScoringDigestV1 | null;
  unsupported: boolean;
  corrupt: boolean;
} {
  if (sourceMetadata == null || typeof sourceMetadata !== "object") {
    return { digest: null, unsupported: false, corrupt: true };
  }
  const candidate = (sourceMetadata as { digest?: unknown }).digest ?? sourceMetadata;
  try {
    const digest = assertParticipantScoringDigestV1(candidate);
    if (digest.extractorCompatVersion !== PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION) {
      return { digest: null, unsupported: true, corrupt: false };
    }
    return { digest, unsupported: false, corrupt: false };
  } catch {
    const raw = candidate as { schemaVersion?: unknown; extractorCompatVersion?: unknown };
    if (
      raw &&
      typeof raw === "object" &&
      (raw.schemaVersion !== "participant-scoring-digest-v1" ||
        raw.extractorCompatVersion !== PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION)
    ) {
      return { digest: null, unsupported: true, corrupt: false };
    }
    return { digest: null, unsupported: false, corrupt: true };
  }
}

function priorDigestLoose(sourceMetadata: unknown): Partial<ParticipantScoringDigestV1> | null {
  if (sourceMetadata == null || typeof sourceMetadata !== "object") return null;
  const candidate = (sourceMetadata as { digest?: unknown }).digest ?? sourceMetadata;
  if (candidate == null || typeof candidate !== "object") return null;
  return candidate as Partial<ParticipantScoringDigestV1>;
}

export async function selectAbilityCatalogReplayCorpus(input: {
  prisma: PrismaClient;
  maxPerSpec?: number;
  maxTotal?: number;
  catalogForCoverage?: AbilityCatalogContext;
  restrictToRowIds?: string[];
  /** When true (default), derive missing topology specs from frozen WclRunRaw. */
  allowFrozenDerivation?: boolean;
}): Promise<CorpusSelectResult> {
  const maxPerSpec = input.maxPerSpec ?? 3;
  const maxTotal = input.maxTotal ?? 120;
  const allowFrozenDerivation = input.allowFrozenDerivation !== false;
  const catalog = input.catalogForCoverage ?? createStaticAbilityCatalogContext();
  const extractorCompatVersion = PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION;

  const topologySpecs = catalog
    .topology()
    .classes.flatMap((c) =>
      c.specs
        .filter((s) => s.supportState !== "UNSUPPORTED")
        .map((s) => ({
          classSlug: c.slug,
          specSlug: s.slug,
          role: s.role,
        })),
    )
    .sort((a, b) =>
      `${a.classSlug}/${a.specSlug}`.localeCompare(`${b.classSlug}/${b.specSlug}`),
    );

  const indexRows = await input.prisma.characterRunDigest.findMany({
    where: {
      ...(input.restrictToRowIds?.length
        ? { id: { in: input.restrictToRowIds } }
        : {}),
    },
    select: {
      id: true,
      rawRunId: true,
      classSlug: true,
      specSlug: true,
      role: true,
      characterName: true,
      realmSlug: true,
      regionCode: true,
      participantActorId: true,
      extractorVersion: true,
    },
    orderBy: { id: "asc" },
  });

  const v4IndexIds = indexRows
    .filter((r) => r.extractorVersion === extractorCompatVersion)
    .map((r) => r.id);

  // Load nested digests only for current extractor rows (avoids huge legacy payloads).
  const v4MetaRows =
    v4IndexIds.length === 0
      ? []
      : await input.prisma.characterRunDigest.findMany({
          where: { id: { in: v4IndexIds } },
          select: { id: true, sourceMetadata: true },
          orderBy: { id: "asc" },
        });
  const metaById = new Map(v4MetaRows.map((r) => [r.id, r.sourceMetadata]));

  let unsupportedSchemaCount = indexRows.filter(
    (r) => r.extractorVersion !== extractorCompatVersion,
  ).length;
  let corruptCount = 0;
  const available: ReplayCorpusCandidate[] = [];
  const nativeBySpec = new Map<string, ReplayCorpusCandidate[]>();

  for (const row of indexRows) {
    if (row.extractorVersion !== extractorCompatVersion) continue;
    const identity = canonicalizeRetailClassSpecIdentity({
      classSlug: row.classSlug,
      specSlug: row.specSlug,
    });
    const sourceMetadata = metaById.get(row.id);
    const parsed = tryParseNestedDigest(sourceMetadata);
    if (parsed.corrupt) {
      corruptCount += 1;
      continue;
    }
    if (parsed.unsupported) {
      unsupportedSchemaCount += 1;
      continue;
    }
    if (!parsed.digest) continue;

    const nestedIdentity = canonicalizeRetailClassSpecIdentity({
      classSlug: parsed.digest.classSlug,
      specSlug: parsed.digest.specSlug,
    });
    const classSlugNorm = nestedIdentity.classSlug ?? identity.classSlug;
    const specSlugNorm = nestedIdentity.specSlug ?? identity.specSlug;
    const candidate: ReplayCorpusCandidate = {
      digestRowId: row.id,
      digest: parsed.digest,
      classSlugNorm,
      specSlugNorm,
      role: roleOf(classSlugNorm, specSlugNorm, parsed.digest.role ?? row.role, catalog),
      coverageStatus: "AVAILABLE_NATIVE_V4",
    };
    available.push(candidate);
    if (classSlugNorm && specSlugNorm) {
      const key = `${classSlugNorm}|${specSlugNorm}`;
      const list = nativeBySpec.get(key) ?? [];
      list.push(candidate);
      nativeBySpec.set(key, list);
    }
  }

  // Derive missing topology specs from frozen WclRunRaw when only older digests exist.
  const derived: ReplayCorpusCandidate[] = [];
  if (allowFrozenDerivation) {
    for (const expected of topologySpecs) {
      const key = `${expected.classSlug}|${expected.specSlug}`;
      if ((nativeBySpec.get(key)?.length ?? 0) > 0) continue;

      const seedRows = indexRows.filter((r) => {
        const id = canonicalizeRetailClassSpecIdentity({
          classSlug: r.classSlug,
          specSlug: r.specSlug,
        });
        return id.classSlug === expected.classSlug && id.specSlug === expected.specSlug;
      });
      if (seedRows.length === 0) continue;

      for (const seed of seedRows.sort((a, b) => a.id.localeCompare(b.id))) {
        const [raw, seedMeta] = await Promise.all([
          input.prisma.wclRunRaw.findUnique({
            where: { id: seed.rawRunId },
            select: { id: true, payload: true },
          }),
          input.prisma.characterRunDigest.findUnique({
            where: { id: seed.id },
            select: { sourceMetadata: true },
          }),
        ]);
        if (!raw) continue;
        const derivedResult = deriveV4ParticipantDigestFromFrozenRaw({
          rawRunId: raw.id,
          rawPayload: raw.payload,
          participantActorId: seed.participantActorId,
          characterName: seed.characterName,
          realmSlug: seed.realmSlug,
          regionCode: seed.regionCode,
          classSlug: expected.classSlug,
          specSlug: expected.specSlug,
          role: seed.role ?? expected.role,
          priorDigest: priorDigestLoose(seedMeta?.sourceMetadata),
        });
        if (!derivedResult.ok) continue;
        const candidate: ReplayCorpusCandidate = {
          digestRowId: `derived:${seed.id}`,
          digest: derivedResult.digest,
          classSlugNorm: expected.classSlug,
          specSlugNorm: expected.specSlug,
          role: roleOf(
            expected.classSlug,
            expected.specSlug,
            derivedResult.digest.role ?? seed.role ?? expected.role,
            catalog,
          ),
          coverageStatus: "DERIVED_FROM_FROZEN_EVIDENCE",
          derivedFromRawRunId: derivedResult.sourceRawRunId,
        };
        derived.push(candidate);
        available.push(candidate);
        break;
      }
    }
  }

  // Group by class/spec for selection.
  const groups = new Map<string, ReplayCorpusCandidate[]>();
  for (const c of available) {
    const key = `${c.classSlugNorm ?? "unknown"}|${c.specSlugNorm ?? "unknown"}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const selected: ReplayCorpusCandidate[] = [];
  const groupKeys = [...groups.keys()].sort();
  for (const key of groupKeys) {
    const list = groups.get(key)!;
    const scored = list.map((c) => {
      const spellIds = collectSpellIds(c.digest);
      const unknownCount = spellIds.filter(
        (id) =>
          catalog.resolveBySpellId({
            spellId: id,
            classSlug: c.digest.classSlug,
            specSlug: c.digest.specSlug,
          }).status === "unmatched",
      ).length;
      const flags = {
        racial: c.digest.loadoutEvidence.raceEvidenceState === "KNOWN" ? 1 : 0,
        offensive: c.digest.performance.offensiveActivations.length > 0 ? 1 : 0,
        defensive: c.digest.survival.personalDefensiveActivations.length > 0 ? 1 : 0,
        interrupt: c.digest.utility.actions.some((a) => a.utilityCategory === "INTERRUPT")
          ? 1
          : 0,
        sparse: spellIds.length > 0 && spellIds.length <= 3 ? 1 : 0,
        unknown: unknownCount > 0 ? 1 : 0,
        native: c.coverageStatus === "AVAILABLE_NATIVE_V4" ? 1 : 0,
      };
      const diversity =
        flags.native * 64 +
        flags.racial * 32 +
        flags.offensive * 16 +
        flags.defensive * 8 +
        flags.interrupt * 4 +
        flags.sparse * 2 +
        flags.unknown;
      return { c, diversity };
    });
    scored.sort((a, b) => {
      if (b.diversity !== a.diversity) return b.diversity - a.diversity;
      return a.c.digestRowId.localeCompare(b.c.digestRowId);
    });
    for (const row of scored.slice(0, maxPerSpec)) {
      selected.push(row.c);
    }
  }

  selected.sort((a, b) => a.digestRowId.localeCompare(b.digestRowId));
  const capped = selected.slice(0, maxTotal);

  const availableClasses = [
    ...new Set(available.map((a) => a.classSlugNorm).filter(Boolean) as string[]),
  ].sort();
  const selectedClasses = [
    ...new Set(capped.map((a) => a.classSlugNorm).filter(Boolean) as string[]),
  ].sort();
  const allClasses = catalog.topology().classes.map((c) => c.slug).sort();

  const nativeSpecKeys = new Set(
    available
      .filter(
        (a) =>
          a.coverageStatus === "AVAILABLE_NATIVE_V4" && a.classSlugNorm && a.specSlugNorm,
      )
      .map((a) => `${a.classSlugNorm}/${a.specSlugNorm}`),
  );
  const derivedSpecKeys = new Set(
    available
      .filter(
        (a) =>
          a.coverageStatus === "DERIVED_FROM_FROZEN_EVIDENCE" &&
          a.classSlugNorm &&
          a.specSlugNorm,
      )
      .map((a) => `${a.classSlugNorm}/${a.specSlugNorm}`),
  );

  const perSpecStatus: AbilityCatalogReplayCorpusSelectionMeta["coverage"]["perSpecStatus"] =
    topologySpecs.map((s) => {
      const key = `${s.classSlug}/${s.specSlug}`;
      let status: CorpusSpecCoverageStatus = "MISSING_CORPUS_EVIDENCE";
      if (nativeSpecKeys.has(key)) status = "AVAILABLE_NATIVE_V4";
      else if (derivedSpecKeys.has(key)) status = "DERIVED_FROM_FROZEN_EVIDENCE";
      else {
        const hadOlder = indexRows.some((r) => {
          const id = canonicalizeRetailClassSpecIdentity({
            classSlug: r.classSlug,
            specSlug: r.specSlug,
          });
          return id.classSlug === s.classSlug && id.specSlug === s.specSlug;
        });
        if (hadOlder) status = "UNSUPPORTED_SCHEMA";
      }
      return { ...s, status };
    });

  const missingSpecs = perSpecStatus
    .filter(
      (s) =>
        s.status === "MISSING_CORPUS_EVIDENCE" || s.status === "UNSUPPORTED_SCHEMA",
    )
    .map(({ classSlug, specSlug, role, status }) => ({
      classSlug,
      specSlug,
      role,
      status,
    }));

  const availableRoles = [
    ...new Set(available.map((a) => a.role).filter(Boolean) as string[]),
  ].sort();
  const selectedRoles = [
    ...new Set(capped.map((a) => a.role).filter(Boolean) as string[]),
  ].sort();
  const allRoles = ["TANK", "HEALER", "DPS"];

  const roleSpecDiversity = allRoles.map((role) => {
    const specs = [
      ...new Set(
        available
          .filter((a) => a.role === role && a.classSlugNorm && a.specSlugNorm)
          .map((a) => `${a.classSlugNorm}/${a.specSlugNorm}`),
      ),
    ].sort();
    return { role, distinctSpecs: specs.length, specs };
  });

  const meta: AbilityCatalogReplayCorpusSelectionMeta = {
    maxPerSpec,
    maxTotal,
    extractorCompatVersion,
    availableCount: available.length,
    selectedCount: capped.length,
    unsupportedSchemaCount,
    corruptCount,
    expectedSpecCount: topologySpecs.length,
    nativeV4SpecCount: nativeSpecKeys.size,
    derivedSpecCount: derivedSpecKeys.size,
    missingSpecCount: missingSpecs.length,
    coverage: {
      classes: {
        available: availableClasses,
        selected: selectedClasses,
        missing: allClasses.filter((c) => !availableClasses.includes(c)),
      },
      specs: {
        available: dedupeSpecs(
          available
            .filter((a) => a.classSlugNorm && a.specSlugNorm)
            .map((a) => ({
              classSlug: a.classSlugNorm!,
              specSlug: a.specSlugNorm!,
              role: a.role,
            })),
        ),
        selected: dedupeSpecs(
          capped
            .filter((a) => a.classSlugNorm && a.specSlugNorm)
            .map((a) => ({
              classSlug: a.classSlugNorm!,
              specSlug: a.specSlugNorm!,
              role: a.role,
            })),
        ),
        missing: missingSpecs.map(({ classSlug, specSlug, role }) => ({
          classSlug,
          specSlug,
          role,
        })),
        expected: topologySpecs,
        nativeV4: [...nativeSpecKeys].sort(),
        derived: [...derivedSpecKeys].sort(),
      },
      perSpecStatus,
      roles: {
        available: availableRoles,
        selected: selectedRoles,
        missing: allRoles.filter((r) => !availableRoles.includes(r)),
        diversity: roleSpecDiversity,
      },
      racialEvidenceSelected: capped.filter(
        (c) => c.digest.loadoutEvidence.raceEvidenceState === "KNOWN",
      ).length,
      offensiveCooldownEvidenceSelected: capped.filter(
        (c) => c.digest.performance.offensiveActivations.length > 0,
      ).length,
      defensiveCooldownEvidenceSelected: capped.filter(
        (c) => c.digest.survival.personalDefensiveActivations.length > 0,
      ).length,
      utilityInterruptEvidenceSelected: capped.filter((c) =>
        c.digest.utility.actions.some((a) => a.utilityCategory === "INTERRUPT"),
      ).length,
      unknownSpellIdEvidenceSelected: capped.filter((c) =>
        collectSpellIds(c.digest).some(
          (id) =>
            catalog.resolveBySpellId({
              spellId: id,
              classSlug: c.digest.classSlug,
              specSlug: c.digest.specSlug,
            }).status === "unmatched",
        ),
      ).length,
      sparseAbilityEvidenceSelected: capped.filter((c) => {
        const n = collectSpellIds(c.digest).length;
        return n > 0 && n <= 3;
      }).length,
      aliasSpellIdEvidenceSelected: capped.filter((c) =>
        collectSpellIds(c.digest).some((id) => {
          const resolved = catalog.resolveBySpellId({
            spellId: id,
            classSlug: c.digest.classSlug,
            specSlug: c.digest.specSlug,
          });
          if (resolved.status !== "matched") return false;
          const primary = resolved.rule.spellIds[0];
          return primary != null && id !== primary;
        }),
      ).length,
    },
    note:
      missingSpecs.length > 0
        ? `Corpus missing ${missingSpecs.length}/${topologySpecs.length} topology specs. Not fully representative.`
        : `All ${topologySpecs.length} topology specs have at least one replay-safe input (native and/or derived).`,
    corpusCoveragePass: missingSpecs.length === 0,
  };

  const corpusDigest = sha256Utf8(
    stableStringify({
      engine: "corpus-select-v2",
      extractorCompatVersion,
      maxPerSpec,
      maxTotal,
      allowFrozenDerivation,
      selectedIds: capped.map((c) => c.digestRowId),
      contentHashes: capped.map((c) => c.digest.contentHash),
      coverageStatuses: capped.map((c) => c.coverageStatus),
    }),
  );

  return {
    available,
    selected: capped,
    unsupportedSchemaCount,
    corruptCount,
    meta,
    corpusDigest,
  };
}

function dedupeSpecs(
  specs: Array<{ classSlug: string; specSlug: string; role: string | null }>,
): Array<{ classSlug: string; specSlug: string; role: string | null }> {
  const map = new Map<string, { classSlug: string; specSlug: string; role: string | null }>();
  for (const s of specs) {
    const k = `${s.classSlug}/${s.specSlug}`;
    if (!map.has(k)) map.set(k, s);
  }
  return [...map.values()].sort((a, b) =>
    `${a.classSlug}/${a.specSlug}`.localeCompare(`${b.classSlug}/${b.specSlug}`),
  );
}

export function collectDigestSpellIds(digest: ParticipantScoringDigestV1): number[] {
  return collectSpellIds(digest);
}

export { normalizeRetailClassSlug, normalizeRetailSpecSlug };
