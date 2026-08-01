/**
 * Read-only evidence join for Agent 11 calibration (server-side / VPS only).
 *
 * Usage (ephemeral container on mplus-test app network — see EVIDENCE-JOIN-RUNBOOK.md):
 *   CALIBRATION_EVIDENCE_ENV=test \
 *   CALIBRATION_EVIDENCE_DATABASE_URL="$DATABASE_URL" \
 *   ALLOW_LIVE_PROVIDER_CALLS=false \
 *   pnpm calibration:evidence-join -- --preflight-only
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPrismaClient } from "@mplus/database";
import { validateSeasonMetaPolicy, validateAuthoritativeSeasonBinding } from "./meta-policy.js";
import {
  MYZOUTH_EXPECTED_CHARACTER_ID,
  isMyzouthMember,
  type ExclusionReason,
} from "./resolve-member.js";
import {
  assertCalibrationEvidenceEnv,
  assertNotProductionEvidenceTarget,
  formatSanitizedDbTarget,
  type SanitizedDbTarget,
} from "./evidence-env-guards.js";
import {
  beginReadOnlyEvidenceTransaction,
  probeReadOnlySqlTransaction,
} from "./read-only-session.js";

const ROOT = resolve(import.meta.dirname, "../../../../../");
const COHORT_DIR = "doc/scoring/cohorts/agent11-2026-08-01";
const POLICY_PATH = "doc/scoring/meta-policies/midnight-season-1.meta.v1.json";
const TMP_DIR = "tmp/calibration/agent11-2026-08-01";
const SCORE_TTL_SECONDS = Number(process.env.SCORE_TTL_SECONDS ?? 604800);

function loadDotEnvKeys(path: string, allowKeys: Set<string>): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!allowKeys.has(key)) continue;
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function envFlag(name: string, defaultValue = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      values.set(key, next);
      i += 1;
    } else {
      flags.add(key);
    }
  }
  return { flags, values };
}

interface ResolvedDocMember {
  id: string;
  region: string;
  realm: string;
  character: string;
  providedRole: string | null;
  expectedTier: string;
  expectedLabel: string;
  resolvedRole: string | null;
  classSlug: string | null;
  specSlug: string | null;
  meta: boolean | "unresolved";
  metaPolicyId: string;
  exclusionReason: ExclusionReason | null;
  roleMismatch: boolean;
  blizzardCharacterId: string | null;
  characterId: string | null;
  snapshotIds: string[];
  evidenceStatus: string;
  provenance?: Record<string, unknown>;
}

function incompleteBootstrap(row: {
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

export async function main(argv = process.argv.slice(2)): Promise<number> {
  loadDotEnvKeys(resolve(ROOT, ".env"), new Set(["SCORE_TTL_SECONDS"]));

  const { flags } = parseArgs(argv);
  const preflightOnly = flags.has("preflight-only") || !flags.has("freeze-bundle");

  try {
    assertCalibrationEvidenceEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }

  if (envFlag("ALLOW_LIVE_PROVIDER_CALLS", false)) {
    console.error("REFUSED: evidence join requires ALLOW_LIVE_PROVIDER_CALLS=false");
    return 2;
  }
  if (flags.has("live-blizzard") || flags.has("enqueue-refresh") || flags.has("call-wcl")) {
    console.error("REFUSED: evidence join forbids provider / refresh flags");
    return 2;
  }

  const evidenceUrl = process.env.CALIBRATION_EVIDENCE_DATABASE_URL?.trim() || "";
  if (!evidenceUrl) {
    console.error(
      "REFUSED: CALIBRATION_EVIDENCE_DATABASE_URL is required (process-scoped; do not write to tracked files)",
    );
    return 2;
  }

  let sanitizedTarget: SanitizedDbTarget;
  try {
    sanitizedTarget = assertNotProductionEvidenceTarget(evidenceUrl);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }

  if (
    (sanitizedTarget.hostname === "localhost" || sanitizedTarget.hostname === "127.0.0.1") &&
    sanitizedTarget.port === "5433"
  ) {
    console.error(
      "REFUSED: evidence join must not use the local compose DATABASE_URL (port 5433). Use the VPS Docker-network path.",
    );
    return 2;
  }

  console.log(`CALIBRATION_EVIDENCE_ENV=test`);
  console.log(`evidenceDbTarget: ${formatSanitizedDbTarget(sanitizedTarget)}`);

  const policy = validateSeasonMetaPolicy(
    JSON.parse(readFileSync(resolve(ROOT, POLICY_PATH), "utf8")),
  );
  if (!policy.ok || !policy.policy) {
    console.error("POLICY_INVALID", policy.errors);
    return 1;
  }

  const resolvedPath = resolve(ROOT, COHORT_DIR, "resolved.v1.json");
  if (!existsSync(resolvedPath)) {
    console.error(`Missing ${COHORT_DIR}/resolved.v1.json — run Blizzard enrichment first`);
    return 1;
  }
  const resolvedDoc = JSON.parse(readFileSync(resolvedPath, "utf8")) as {
    members: ResolvedDocMember[];
    cohortId: string;
  };

  const prisma = createPrismaClient(evidenceUrl);
  const now = new Date();
  const nowIso = now.toISOString();

  type MemberEvidenceRow = Record<string, unknown>;
  let memberRows: MemberEvidenceRow[] = [];
  let seasonBinding: { ok: boolean; errors?: string[]; season?: unknown; activeModel?: unknown } = {
    ok: false,
  };
  let readOnlyProven = false;
  let transactionReadOnly: string | null = null;
  let probeSqlState: string | null = null;

  try {
    // 1) Dedicated probe transaction — require SQLSTATE 25006 on regions UPDATE.
    const probe = await probeReadOnlySqlTransaction(prisma);
    readOnlyProven = true;
    probeSqlState = probe.sqlState;
    console.log(`read_only_probe: transaction_read_only=${probe.transactionReadOnly} sqlState=${probe.sqlState}`);

    // 2) Separate READ ONLY transaction for all evidence queries (tx client only).
    const evidence = await beginReadOnlyEvidenceTransaction(prisma, async (tx, evidenceRo) => {
      transactionReadOnly = evidenceRo;
      console.log(`transaction_read_only=${transactionReadOnly}`);

      const season = await tx.season.findFirst({
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
      const binding = validateAuthoritativeSeasonBinding(policy.policy!, season);
      const activeModel = await tx.scoreModel.findFirst({
        where: { status: "ACTIVE" },
        select: { id: true, key: true, version: true, status: true },
      });

      seasonBinding = {
        ok: binding.ok,
        errors: binding.ok ? undefined : binding.errors,
        season,
        activeModel,
      };

      const rows: MemberEvidenceRow[] = [];
      for (const member of resolvedDoc.members) {
        const chars = await tx.character.findMany({
          where: {
            normalizedName: member.character.toLowerCase(),
            realm: { slug: member.realm.toLowerCase() },
            region: { code: member.region.toUpperCase() },
          },
          include: {
            realm: { select: { id: true, slug: true, name: true } },
            region: { select: { id: true, code: true } },
            gameClass: { select: { slug: true } },
            activeSpec: { select: { slug: true, role: true } },
          },
          take: 3,
        });

        const character = chars[0] ?? null;
        const snapshots = character
          ? await tx.scoreSnapshot.findMany({
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
                scoreModelId: true,
                overallScore: true,
                grade: true,
                confidence: true,
                calculatedAt: true,
                providerDataAsOf: true,
                coverageState: true,
                publicationStatus: true,
                explanation: true,
                scoreModel: { select: { id: true, key: true, version: true, status: true } },
                season: { select: { id: true, slug: true, blizzardSeasonId: true } },
              },
            })
          : [];

        const obsCount =
          character && season
            ? await tx.metricObservation.count({
                where: { characterId: character.id, seasonId: season.id },
              })
            : 0;

        const latest = snapshots[0] ?? null;
        const ageSec = latest
          ? Math.floor((now.getTime() - new Date(latest.calculatedAt).getTime()) / 1000)
          : null;
        const freshEnough = ageSec != null && ageSec <= SCORE_TTL_SECONDS;
        const modelCompatible =
          latest != null &&
          activeModel != null &&
          latest.scoreModel.key === activeModel.key &&
          latest.scoreModel.version === activeModel.version;
        const seasonCompatible =
          latest != null &&
          season != null &&
          (latest.seasonId === season.id || latest.season.slug === season.slug);

        const bootstrapComplete = character ? !incompleteBootstrap(character) : false;
        const compatibleV6 = Boolean(latest) && modelCompatible && seasonCompatible && freshEnough;

        let snapshotStatus:
          | "COMPATIBLE_V6"
          | "STALE_OR_INCOMPATIBLE"
          | "NO_SNAPSHOT"
          | "IDENTITY_MISSING" = "IDENTITY_MISSING";
        if (!character) snapshotStatus = "IDENTITY_MISSING";
        else if (!latest) snapshotStatus = "NO_SNAPSHOT";
        else if (compatibleV6) snapshotStatus = "COMPATIBLE_V6";
        else snapshotStatus = "STALE_OR_INCOMPATIBLE";

        const requiresScoreRefresh =
          member.exclusionReason == null && character != null && snapshotStatus !== "COMPATIBLE_V6";

        const explanation = (latest?.explanation ?? null) as Record<string, unknown> | null;
        const coverage =
          explanation && typeof explanation === "object"
            ? ((explanation as { coverage?: Record<string, unknown> }).coverage ?? null)
            : null;

        rows.push({
          memberId: member.id,
          identity: `${member.region}/${member.realm}/${member.character}`,
          expectedTier: member.expectedTier,
          expectedLabel: member.expectedLabel,
          providedRole: member.providedRole,
          resolvedRole: member.resolvedRole,
          exclusionReason: member.exclusionReason,
          roleMismatch: member.roleMismatch,
          classSlug: member.classSlug,
          specSlug: member.specSlug,
          meta: member.meta,
          foundInDb: Boolean(character),
          characterId: character?.id ?? null,
          blizzardCharacterId:
            character?.blizzardCharacterId != null
              ? String(character.blizzardCharacterId)
              : member.blizzardCharacterId,
          realmSlug: character?.realm.slug ?? member.realm,
          regionCode: character?.region.code ?? member.region,
          persistedClassSlug: character?.gameClass?.slug ?? null,
          persistedSpecSlug: character?.activeSpec?.slug ?? null,
          persistedRole: character?.role ?? character?.activeSpec?.role ?? null,
          level: character?.level ?? null,
          bootstrapComplete,
          incompleteBootstrap: character ? !bootstrapComplete : null,
          lastPublicRefreshAt: character?.lastPublicRefreshAt?.toISOString() ?? null,
          snapshotStatus,
          latestSnapshotId: latest?.id ?? null,
          latestSnapshotCalculatedAt: latest?.calculatedAt?.toISOString() ?? null,
          latestSnapshotAgeSeconds: ageSec,
          latestGrade: latest?.grade ?? null,
          latestOverallScore: latest?.overallScore ?? null,
          latestModel: latest
            ? {
                id: latest.scoreModel.id,
                key: latest.scoreModel.key,
                version: latest.scoreModel.version,
              }
            : null,
          modelCompatible,
          seasonCompatible,
          freshEnough,
          requiresScoreRefresh,
          observationCountForSeason: obsCount,
          selectedRunCoverage:
            coverage && typeof coverage.selectedRunCoverage === "number"
              ? coverage.selectedRunCoverage
              : null,
          freshnessCoverage:
            coverage && typeof coverage.freshness === "number" ? coverage.freshness : null,
          isMyzouth: isMyzouthMember(member),
          myzouthExpectedId: isMyzouthMember(member) ? MYZOUTH_EXPECTED_CHARACTER_ID : null,
          myzouthIdMatch:
            isMyzouthMember(member) && character
              ? character.id === MYZOUTH_EXPECTED_CHARACTER_ID
              : null,
        });
      }
      return rows;
    });

    memberRows = evidence.result;
    transactionReadOnly = evidence.transactionReadOnly;
  } finally {
    await prisma.$disconnect();
  }

  const uniqueIdentities = new Map<string, MemberEvidenceRow[]>();
  for (const row of memberRows) {
    const key = String(row.identity);
    const list = uniqueIdentities.get(key) ?? [];
    list.push(row);
    uniqueIdentities.set(key, list);
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
  const requiresRefresh = memberRows.filter((r) => r.requiresScoreRefresh === true).length;

  const myzouth = memberRows.find((r) => r.isMyzouth === true) ?? null;

  const phaseBEstimate = {
    note: "No WCL/score refresh is approved by this preflight. Estimates only.",
    membersRequiringScoreRefresh: requiresRefresh,
    identitiesMissingFromDb: identityMissing,
    incompleteBootstrapRows: incompleteBootstrapCount,
    estimatedBlizzardProfileCallsIfRefreshAuthorized: requiresRefresh + incompleteBootstrapCount,
    estimatedWclCallsIfRefreshAuthorized: requiresRefresh,
    estimatedRaiderIoCallsIfRefreshAuthorized: requiresRefresh,
  };

  const summary = {
    generatedAt: nowIso,
    preflightOnly,
    readOnlyProven,
    probeSqlState,
    transactionReadOnly,
    evidenceDbTarget: sanitizedTarget,
    seasonBinding,
    counts: {
      intakeMembers: memberRows.length,
      uniqueIdentities: uniqueIdentities.size,
      identitiesFoundInTestDb: identityFound,
      identitiesMissingFromTestDb: identityMissing,
      completeBlizzardBootstrapRows: completeBootstrap,
      incompleteBootstrapRows: incompleteBootstrapCount,
      membersCompatibleV6Snapshot: compatible,
      membersStaleOrIncompatibleSnapshot: stale,
      membersNoScoreSnapshot: noSnap,
      membersRequiringScoreRefresh: requiresRefresh,
    },
    myzouth: myzouth
      ? {
          memberId: myzouth.memberId,
          characterId: myzouth.characterId,
          expectedCharacterId: MYZOUTH_EXPECTED_CHARACTER_ID,
          idMatch: myzouth.myzouthIdMatch,
          bootstrapComplete: myzouth.bootstrapComplete,
          snapshotStatus: myzouth.snapshotStatus,
          exclusionReason: myzouth.exclusionReason,
          deferred: myzouth.exclusionReason === "MYZOUTH_BOOTSTRAP_DEFERRED",
        }
      : null,
    seasonModelCompatibility: {
      seasonBindingOk: seasonBinding.ok,
      activeModel: seasonBinding.activeModel ?? null,
      authoritativeSeason: seasonBinding.season ?? null,
      policyId: policy.policy!.policyId,
      policySeasonSlug: policy.policy!.seasonSlug,
    },
    phaseBEstimate,
  };

  const tmpDir = resolve(ROOT, TMP_DIR);
  mkdirSync(tmpDir, { recursive: true });

  writeFileSync(
    resolve(tmpDir, "evidence-join.preflight.json"),
    JSON.stringify({ schemaVersion: "agent11-evidence-join-preflight-v1", ...summary, members: memberRows }, null, 2),
  );
  writeFileSync(resolve(tmpDir, "evidence-join.summary.json"), JSON.stringify(summary, null, 2));

  const md = [
    `# Evidence join preflight — ${resolvedDoc.cohortId}`,
    "",
    `Generated: ${nowIso}`,
    `Read-only probe proven: **${readOnlyProven}** (SQLSTATE **${probeSqlState}** on zero-row UPDATE of regions)`,
    `Evidence SHOW transaction_read_only: **${transactionReadOnly}**`,
    `Evidence DB target: \`${formatSanitizedDbTarget(sanitizedTarget)}\``,
    "",
    "## Counts",
    "",
    `| Metric | Count |`,
    `|---|---:|`,
    `| Unique identities found in test DB | ${identityFound} |`,
    `| Unique identities missing | ${identityMissing} |`,
    `| Complete Blizzard bootstrap rows | ${completeBootstrap} |`,
    `| Incomplete bootstrap rows | ${incompleteBootstrapCount} |`,
    `| Compatible v6 snapshots | ${compatible} |`,
    `| Stale/incompatible snapshots | ${stale} |`,
    `| No score snapshot | ${noSnap} |`,
    `| Requiring score refresh (estimate) | ${requiresRefresh} |`,
    "",
    "## Myzouth",
    "",
    "```json",
    JSON.stringify(summary.myzouth, null, 2),
    "```",
    "",
    "## Season / model",
    "",
    "```json",
    JSON.stringify(summary.seasonModelCompatibility, null, 2),
    "```",
    "",
    "## Phase B estimate (not approved)",
    "",
    "```json",
    JSON.stringify(phaseBEstimate, null, 2),
    "```",
    "",
    "> Bundle was **not** frozen. No provider refresh was enqueued.",
    "",
  ].join("\n");
  writeFileSync(resolve(tmpDir, "evidence-join.preflight.md"), md);

  console.log(JSON.stringify(summary, null, 2));

  if (!readOnlyProven || probeSqlState !== "25006" || transactionReadOnly !== "on") {
    console.error("REFUSED: read-only enforcement was not proven (need SQLSTATE 25006 + transaction_read_only=on)");
    return 1;
  }
  if (!seasonBinding.ok) {
    console.error("SEASON_BINDING_FAILED", seasonBinding.errors);
    return 1;
  }
  if (!preflightOnly) {
    console.error("freeze-bundle is not implemented in this pass — stop after preflight");
    return 2;
  }
  return 0;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return entry.replace(/\\/g, "/").endsWith("/calibration/evidence-join-readonly-cli.ts");
  }
}

if (isMain()) {
  main().then((code) => process.exit(code));
}
