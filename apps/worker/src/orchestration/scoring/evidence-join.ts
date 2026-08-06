/**
 * Generic read-only evidence join for calibration cohorts.
 * Provider-free. Does not enqueue refreshes or mutate character/evidence/score rows.
 *
 * Extracted from Agent 11 CLI so the admin control center and CLI share one implementation.
 */
import type { PrismaClient } from "@mplus/database";
import {
  EVIDENCE_JOIN_PREFLIGHT_SCHEMA_VERSION,
  type ScoringEvidenceExportProgressDTO,
  type ScoringIssueDTO,
} from "@mplus/contracts";

const PHASE1_DIMENSIONS = ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"] as const;

export type SnapshotStatus =
  | "COMPATIBLE_V6"
  | "STALE_OR_INCOMPATIBLE"
  | "NO_SNAPSHOT"
  | "IDENTITY_MISSING"
  | "EXCLUDED";

export interface EvidenceJoinMemberInput {
  memberId: string;
  region: string;
  realmSlug: string;
  characterName: string;
  expectedLabel: string;
  providedRole: string | null;
  classSlug: string | null;
  specSlug: string | null;
  characterId: string | null;
  included: boolean;
  exclusionCode: string | null;
  exclusionDetail: string | null;
}

export interface EvidenceJoinInput {
  cohortId: string;
  cohortRevision: number;
  cohortName: string;
  seasonId: string | null;
  members: EvidenceJoinMemberInput[];
  scoreTtlSeconds: number;
  now?: Date;
}

export interface EvidenceJoinMemberResult {
  memberId: string;
  identity: string;
  expectedLabel: string;
  providedRole: string | null;
  exclusionCode: string | null;
  included: boolean;
  foundInDb: boolean;
  characterId: string | null;
  bootstrapComplete: boolean | null;
  incompleteBootstrap: boolean | null;
  snapshotStatus: SnapshotStatus;
  latestSnapshotId: string | null;
  modelCompatible: boolean | null;
  seasonCompatible: boolean | null;
  freshEnough: boolean | null;
  requiresScoreRefresh: boolean;
  observationCountForSeason: number;
  manifestId: string | null;
  manifestContentHash: string | null;
  factSetCount: number;
  dimensionsPresent: string[];
  fourDimensionsComplete: boolean;
  level: number | null;
  persistedClassSlug: string | null;
  persistedSpecSlug: string | null;
  persistedRole: string | null;
}

export interface EvidenceJoinResult {
  schemaVersion: typeof EVIDENCE_JOIN_PREFLIGHT_SCHEMA_VERSION;
  generatedAt: string;
  cohortId: string;
  cohortRevision: number;
  cohortName: string;
  seasonBinding: {
    ok: boolean;
    errors?: string[];
    season: {
      id: string;
      slug: string;
      isCurrent: boolean;
      blizzardSeasonId: number | null;
      name: string;
    } | null;
    activeModel: {
      id: string;
      key: string;
      version: number;
      status: string;
    } | null;
  };
  counts: {
    intakeMembers: number;
    uniqueIdentities: number;
    identitiesFound: number;
    identitiesMissing: number;
    completeBootstrapRows: number;
    incompleteBootstrapRows: number;
    membersCompatibleV6Snapshot: number;
    membersStaleOrIncompatibleSnapshot: number;
    membersNoScoreSnapshot: number;
    membersExcluded: number;
    membersRequiringScoreRefresh: number;
    membersWithManifest: number;
    membersWithFourDimensions: number;
  };
  progress: ScoringEvidenceExportProgressDTO;
  issues: ScoringIssueDTO[];
  blockerCount: number;
  warningCount: number;
  members: EvidenceJoinMemberResult[];
  freezeEligible: boolean;
}

export function incompleteBootstrap(row: {
  level: number | null;
  blizzardCharacterId: bigint | null;
  classId: string | null;
  activeSpecId: string | null;
  role: string | null;
}): boolean {
  return (
    row.level == null ||
    row.blizzardCharacterId == null ||
    row.classId == null ||
    row.activeSpecId == null ||
    row.role == null
  );
}

export function classifySnapshotStatus(input: {
  foundInDb: boolean;
  excluded: boolean;
  hasLatest: boolean;
  compatible: boolean;
}): SnapshotStatus {
  if (input.excluded) return "EXCLUDED";
  if (!input.foundInDb) return "IDENTITY_MISSING";
  if (!input.hasLatest) return "NO_SNAPSHOT";
  if (input.compatible) return "COMPATIBLE_V6";
  return "STALE_OR_INCOMPATIBLE";
}

export function aggregateEvidenceIssues(
  members: EvidenceJoinMemberResult[],
  seasonOk: boolean,
  seasonErrors: string[] | undefined,
  hasActiveModel: boolean,
): ScoringIssueDTO[] {
  const issues: ScoringIssueDTO[] = [];
  if (!seasonOk) {
    for (const message of seasonErrors ?? ["Season binding failed"]) {
      issues.push({ code: "SEASON_BINDING_FAILED", severity: "blocker", message });
    }
  }
  if (!hasActiveModel) {
    issues.push({
      code: "ACTIVE_MODEL_MISSING",
      severity: "blocker",
      message: "No ACTIVE score model is available",
    });
  }
  for (const m of members) {
    if (!m.included || m.exclusionCode) continue;
    if (!m.foundInDb) {
      issues.push({
        code: "IDENTITY_MISSING",
        severity: "blocker",
        message: `Identity not found in database: ${m.identity}`,
        memberId: m.memberId,
      });
      continue;
    }
    if (m.incompleteBootstrap) {
      issues.push({
        code: "BOOTSTRAP_INCOMPLETE",
        severity: "blocker",
        message: `Bootstrap incomplete for ${m.identity}`,
        memberId: m.memberId,
      });
    }
    if (m.snapshotStatus === "NO_SNAPSHOT" || m.snapshotStatus === "STALE_OR_INCOMPATIBLE") {
      issues.push({
        code: "SNAPSHOT_INCOMPATIBLE",
        severity: "warning",
        message: `Snapshot ${m.snapshotStatus.toLowerCase()} for ${m.identity}`,
        memberId: m.memberId,
      });
    }
    if (!m.manifestId) {
      issues.push({
        code: "MANIFEST_MISSING",
        severity: "warning",
        message: `No Scoring V2 manifest for ${m.identity}`,
        memberId: m.memberId,
      });
    }
    if (m.manifestId && !m.fourDimensionsComplete) {
      issues.push({
        code: "DIMENSIONS_INCOMPLETE",
        severity: "warning",
        message: `Four-dimension coverage incomplete for ${m.identity}`,
        memberId: m.memberId,
      });
    }
  }
  return issues;
}

export function buildEvidenceJoinMarkdown(result: EvidenceJoinResult): string {
  const lines = [
    `# Evidence join preflight — ${result.cohortName}`,
    "",
    `Cohort: \`${result.cohortId}\` revision **${result.cohortRevision}**`,
    `Generated: ${result.generatedAt}`,
    `Schema: \`${result.schemaVersion}\``,
    "",
    "## Counts",
    "",
    `| Metric | Count |`,
    `|---|---:|`,
    `| Intake members | ${result.counts.intakeMembers} |`,
    `| Unique identities | ${result.counts.uniqueIdentities} |`,
    `| Identities found | ${result.counts.identitiesFound} |`,
    `| Identities missing | ${result.counts.identitiesMissing} |`,
    `| Complete bootstrap | ${result.counts.completeBootstrapRows} |`,
    `| Incomplete bootstrap | ${result.counts.incompleteBootstrapRows} |`,
    `| Compatible snapshots | ${result.counts.membersCompatibleV6Snapshot} |`,
    `| Stale/incompatible snapshots | ${result.counts.membersStaleOrIncompatibleSnapshot} |`,
    `| No snapshot | ${result.counts.membersNoScoreSnapshot} |`,
    `| Excluded | ${result.counts.membersExcluded} |`,
    `| Requiring refresh (estimate) | ${result.counts.membersRequiringScoreRefresh} |`,
    `| With V2 manifest | ${result.counts.membersWithManifest} |`,
    `| Four dimensions complete | ${result.counts.membersWithFourDimensions} |`,
    "",
    "## Freeze eligibility",
    "",
    result.freezeEligible
      ? "Eligible for Calibration Input Bundle V2 freeze (no blockers)."
      : `Not eligible — ${result.blockerCount} blocker(s), ${result.warningCount} warning(s).`,
    "",
    "## Issues",
    "",
  ];
  if (result.issues.length === 0) {
    lines.push("_None._", "");
  } else {
    for (const issue of result.issues) {
      lines.push(`- **${issue.severity}** \`${issue.code}\`: ${issue.message}`);
    }
    lines.push("");
  }
  lines.push(
    "> This preflight is provider-free. No refresh was enqueued. Bundle freeze is a separate explicit action.",
    "",
  );
  return lines.join("\n");
}

/**
 * Run a read-only evidence join against persisted cohort members.
 * Uses the application Prisma client (never accepts a database URL).
 */
export async function runEvidenceJoin(
  prisma: PrismaClient,
  input: EvidenceJoinInput,
): Promise<EvidenceJoinResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  const season =
    input.seasonId != null
      ? await prisma.season.findUnique({
          where: { id: input.seasonId },
          select: {
            id: true,
            slug: true,
            isCurrent: true,
            blizzardSeasonId: true,
            name: true,
          },
        })
      : await prisma.season.findFirst({
          where: { isCurrent: true },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            slug: true,
            isCurrent: true,
            blizzardSeasonId: true,
            name: true,
          },
        });

  const activeModel = await prisma.scoreModel.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true, key: true, version: true, status: true },
  });

  const seasonErrors: string[] = [];
  if (!season) seasonErrors.push("No season found for evidence join");
  if (input.seasonId && season && season.id !== input.seasonId) {
    seasonErrors.push("Requested season does not match resolved season");
  }
  const seasonOk = seasonErrors.length === 0 && season != null;

  const memberRows: EvidenceJoinMemberResult[] = [];

  for (const member of input.members) {
    const identity = `${member.region}/${member.realmSlug}/${member.characterName}`;
    const excluded = !member.included || member.exclusionCode != null;

    let character =
      member.characterId != null
        ? await prisma.character.findUnique({
            where: { id: member.characterId },
            include: {
              realm: { select: { slug: true } },
              region: { select: { code: true } },
              gameClass: { select: { slug: true } },
              activeSpec: { select: { slug: true, role: true } },
            },
          })
        : null;

    if (!character) {
      const chars = await prisma.character.findMany({
        where: {
          normalizedName: member.characterName.toLowerCase(),
          realm: { slug: member.realmSlug.toLowerCase() },
          region: { code: member.region.toUpperCase() },
        },
        include: {
          realm: { select: { slug: true } },
          region: { select: { code: true } },
          gameClass: { select: { slug: true } },
          activeSpec: { select: { slug: true, role: true } },
        },
        take: 3,
      });
      character = chars[0] ?? null;
    }

    const snapshots = character
      ? await prisma.scoreSnapshot.findMany({
          where: {
            characterId: character.id,
            isPublic: true,
            publicationStatus: { in: ["PUBLIC", "PUBLISHED"] },
            scopeType: "CHARACTER",
          },
          orderBy: { calculatedAt: "desc" },
          take: 5,
          select: {
            id: true,
            seasonId: true,
            calculatedAt: true,
            scoreModel: { select: { id: true, key: true, version: true, status: true } },
            season: { select: { id: true, slug: true } },
          },
        })
      : [];

    const latest = snapshots[0] ?? null;
    const ageSec = latest
      ? Math.floor((now.getTime() - new Date(latest.calculatedAt).getTime()) / 1000)
      : null;
    const freshEnough = ageSec != null && ageSec <= input.scoreTtlSeconds;
    const modelCompatible =
      latest != null &&
      activeModel != null &&
      latest.scoreModel.key === activeModel.key &&
      latest.scoreModel.version === activeModel.version;
    const seasonCompatible =
      latest != null &&
      season != null &&
      (latest.seasonId === season.id || latest.season.slug === season.slug);
    const compatible = Boolean(latest) && modelCompatible && seasonCompatible && freshEnough;

    const bootstrapComplete = character ? !incompleteBootstrap(character) : false;
    const snapshotStatus = classifySnapshotStatus({
      foundInDb: Boolean(character),
      excluded,
      hasLatest: Boolean(latest),
      compatible,
    });

    const requiresScoreRefresh =
      !excluded && character != null && snapshotStatus !== "COMPATIBLE_V6";

    const obsCount =
      character && season
        ? await prisma.metricObservation.count({
            where: { characterId: character.id, seasonId: season.id },
          })
        : 0;

    let manifestId: string | null = null;
    let manifestContentHash: string | null = null;
    let factSetCount = 0;
    let dimensionsPresent: string[] = [];
    let fourDimensionsComplete = false;

    if (character && season) {
      const manifest = await prisma.evidenceManifest.findFirst({
        where: { characterId: character.id, seasonId: season.id },
        orderBy: { frozenAt: "desc" },
        select: { id: true, contentHash: true },
      });
      if (manifest) {
        manifestId = manifest.id;
        manifestContentHash = manifest.contentHash;
        factSetCount = await prisma.runFactSet.count({
          where: { characterId: character.id, manifestSlot: { manifestId: manifest.id } },
        });
        const dims = await prisma.dimensionComputation.findMany({
          where: {
            characterId: character.id,
            seasonId: season.id,
            manifestId: manifest.id,
            ...(activeModel ? { scoreModelId: activeModel.id } : {}),
          },
          select: { dimension: true },
        });
        dimensionsPresent = [...new Set(dims.map((d) => d.dimension))];
        fourDimensionsComplete = PHASE1_DIMENSIONS.every((d) => dimensionsPresent.includes(d));
      }
    }

    memberRows.push({
      memberId: member.memberId,
      identity,
      expectedLabel: member.expectedLabel,
      providedRole: member.providedRole,
      exclusionCode: member.exclusionCode,
      included: member.included,
      foundInDb: Boolean(character),
      characterId: character?.id ?? null,
      bootstrapComplete: character ? bootstrapComplete : null,
      incompleteBootstrap: character ? !bootstrapComplete : null,
      snapshotStatus,
      latestSnapshotId: latest?.id ?? null,
      modelCompatible: latest ? modelCompatible : null,
      seasonCompatible: latest ? seasonCompatible : null,
      freshEnough: latest ? freshEnough : null,
      requiresScoreRefresh,
      observationCountForSeason: obsCount,
      manifestId,
      manifestContentHash,
      factSetCount,
      dimensionsPresent,
      fourDimensionsComplete,
      level: character?.level ?? null,
      persistedClassSlug: character?.gameClass?.slug ?? null,
      persistedSpecSlug: character?.activeSpec?.slug ?? null,
      persistedRole: character?.role ?? character?.activeSpec?.role ?? null,
    });
  }

  const uniqueIdentities = new Map<string, EvidenceJoinMemberResult[]>();
  for (const row of memberRows) {
    const list = uniqueIdentities.get(row.identity) ?? [];
    list.push(row);
    uniqueIdentities.set(row.identity, list);
  }
  const identityFound = [...uniqueIdentities.values()].filter((rows) =>
    rows.some((r) => r.foundInDb),
  ).length;
  const identityMissing = uniqueIdentities.size - identityFound;
  const foundRows = memberRows.filter((r) => r.foundInDb);
  const completeBootstrap = foundRows.filter((r) => r.bootstrapComplete === true).length;
  const incompleteBootstrapCount = foundRows.filter((r) => r.incompleteBootstrap === true).length;
  const compatible = memberRows.filter((r) => r.snapshotStatus === "COMPATIBLE_V6").length;
  const stale = memberRows.filter((r) => r.snapshotStatus === "STALE_OR_INCOMPATIBLE").length;
  const noSnap = memberRows.filter((r) => r.snapshotStatus === "NO_SNAPSHOT").length;
  const excludedCount = memberRows.filter(
    (r) => r.snapshotStatus === "EXCLUDED" || !r.included || r.exclusionCode != null,
  ).length;
  const requiresRefresh = memberRows.filter((r) => r.requiresScoreRefresh).length;
  const withManifest = memberRows.filter((r) => r.manifestId != null).length;
  const withFourDims = memberRows.filter((r) => r.fourDimensionsComplete).length;

  const issues = aggregateEvidenceIssues(
    memberRows,
    seasonOk,
    seasonErrors,
    activeModel != null,
  );
  const blockerCount = issues.filter((i) => i.severity === "blocker").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  const progress: ScoringEvidenceExportProgressDTO = {
    membersTotal: memberRows.length,
    membersScanned: memberRows.length,
    identitiesFound: identityFound,
    identitiesMissing: identityMissing,
    bootstrapComplete: completeBootstrap,
    bootstrapIncomplete: incompleteBootstrapCount,
    manifestsPresent: withManifest,
    fourDimensionComplete: withFourDims,
    compatibleSnapshots: compatible,
    incompatibleSnapshots: stale + noSnap,
  };

  const result: EvidenceJoinResult = {
    schemaVersion: EVIDENCE_JOIN_PREFLIGHT_SCHEMA_VERSION,
    generatedAt: nowIso,
    cohortId: input.cohortId,
    cohortRevision: input.cohortRevision,
    cohortName: input.cohortName,
    seasonBinding: {
      ok: seasonOk,
      errors: seasonOk ? undefined : seasonErrors,
      season,
      activeModel,
    },
    counts: {
      intakeMembers: memberRows.length,
      uniqueIdentities: uniqueIdentities.size,
      identitiesFound: identityFound,
      identitiesMissing: identityMissing,
      completeBootstrapRows: completeBootstrap,
      incompleteBootstrapRows: incompleteBootstrapCount,
      membersCompatibleV6Snapshot: compatible,
      membersStaleOrIncompatibleSnapshot: stale,
      membersNoScoreSnapshot: noSnap,
      membersExcluded: excludedCount,
      membersRequiringScoreRefresh: requiresRefresh,
      membersWithManifest: withManifest,
      membersWithFourDimensions: withFourDims,
    },
    progress,
    issues,
    blockerCount,
    warningCount,
    members: memberRows,
    freezeEligible: blockerCount === 0 && seasonOk && activeModel != null,
  };

  return result;
}
