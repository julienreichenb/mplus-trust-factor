/**
 * Agent 11 calibration cohort enrichment CLI (API-side, outside @mplus/scoring).
 *
 * Usage:
 *   pnpm calibration:cohort-enrich -- --dry-run --live-blizzard
 *   ALLOW_LIVE_PROVIDER_CALLS=true pnpm calibration:cohort-enrich -- --live-blizzard
 *
 * Evidence DB joins belong on the test VPS via `pnpm calibration:evidence-join`
 * (see EVIDENCE-JOIN-RUNBOOK.md). Do not store remote test DATABASE_URL on laptops.
 *
 * Never enqueues refresh jobs. Blizzard profile only when --live-blizzard is set.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPrismaClient, type PrismaClient } from "@mplus/database";
import { validateCohortIntake } from "./intake.js";
import { validateSeasonMetaPolicy, validateAuthoritativeSeasonBinding } from "./meta-policy.js";
import {
  enrichIdentitiesWithBlizzardProfiles,
  assertProfileOnlyEnrichmentSafety,
  blizzardCacheKey,
  type ProviderCallLedgerEntry,
} from "./blizzard-profile-enrichment.js";
import {
  resolveIntakeMember,
  toStrictManifestMember,
  type PersistedCharacterLookup,
  type ResolvedMember,
  type ExclusionRecord,
} from "./resolve-member.js";
import { COHORT_MANIFEST_SCHEMA_VERSION } from "@mplus/scoring";

const ROOT = resolve(import.meta.dirname, "../../../../../");
const CANONICAL_INTAKE = "doc/scoring/cohorts/agent11-2026-08-01/intake.v1.json";
const CANONICAL_POLICY = "doc/scoring/meta-policies/midnight-season-1.meta.v1.json";
const COHORT_DIR = "doc/scoring/cohorts/agent11-2026-08-01";
const TMP_DIR = "tmp/calibration/agent11-2026-08-01";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
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

function envFlag(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

async function lookupPersisted(
  prisma: PrismaClient,
  region: string,
  realm: string,
  character: string,
): Promise<PersistedCharacterLookup | null> {
  const rows = await prisma.character.findMany({
    where: {
      normalizedName: character.toLowerCase(),
      realm: { slug: realm.toLowerCase() },
      region: { code: region.toUpperCase() },
    },
    include: {
      gameClass: { select: { slug: true } },
      activeSpec: { select: { slug: true, role: true } },
      scoreSnapshots: {
        where: { isPublic: true, publicationStatus: { in: ["PUBLIC", "PUBLISHED"] }, scopeType: "CHARACTER" },
        orderBy: { calculatedAt: "desc" },
        take: 5,
        select: { id: true },
      },
    },
    take: 2,
  });
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    // Prefer exact display-name case-insensitive match
    const exact = rows.find((r) => r.displayName.toLowerCase() === character.toLowerCase()) ?? rows[0]!;
    return mapPersisted(exact);
  }
  return mapPersisted(rows[0]!);
}

function mapPersisted(row: {
  id: string;
  role: string | null;
  blizzardCharacterId: bigint | null;
  level: number | null;
  faction: string | null;
  lastPublicRefreshAt: Date | null;
  classId: string | null;
  activeSpecId: string | null;
  gameClass: { slug: string } | null;
  activeSpec: { slug: string; role: string } | null;
  scoreSnapshots: { id: string }[];
}): PersistedCharacterLookup {
  const incompleteBootstrap =
    row.level == null ||
    row.blizzardCharacterId == null ||
    row.classId == null ||
    row.activeSpecId == null ||
    row.role == null;
  return {
    characterId: row.id,
    blizzardCharacterId: row.blizzardCharacterId != null ? String(row.blizzardCharacterId) : null,
    role:
      row.role === "DPS" || row.role === "TANK" || row.role === "HEALER"
        ? row.role
        : row.activeSpec?.role === "DPS" ||
            row.activeSpec?.role === "TANK" ||
            row.activeSpec?.role === "HEALER"
          ? row.activeSpec.role
          : null,
    classSlug: row.gameClass?.slug ?? null,
    specSlug: row.activeSpec?.slug ?? null,
    level: row.level,
    faction: row.faction,
    lastPublicRefreshAt: row.lastPublicRefreshAt?.toISOString() ?? null,
    snapshotIds: row.scoreSnapshots.map((s) => s.id),
    incompleteBootstrap,
  };
}

async function loadAuthoritativeSeason(prisma: PrismaClient) {
  return prisma.season.findFirst({
    where: { isCurrent: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, slug: true, isCurrent: true, blizzardSeasonId: true },
  });
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  loadEnvFile(resolve(ROOT, ".env"));
  const { flags, values } = parseArgs(argv);
  const dryRun = flags.has("dry-run");
  const liveBlizzard = flags.has("live-blizzard");
  const myzouthRecoveryComplete = flags.has("myzouth-recovery-complete");
  const petbearDistinct = flags.has("petbear-role-contexts-proven");

  const evidenceDbUrl =
    values.get("evidence-db-url") ??
    process.env.CALIBRATION_EVIDENCE_DATABASE_URL ??
    null;

  assertProfileOnlyEnrichmentSafety({
    allowLiveProviderCalls: liveBlizzard ? envFlag("ALLOW_LIVE_PROVIDER_CALLS") || dryRun : true,
    enqueueRefresh: flags.has("enqueue-refresh"),
    callWcl: flags.has("call-wcl"),
    callRaiderIo: flags.has("call-raiderio"),
    activateModel: flags.has("activate-model"),
  });

  if (liveBlizzard && !dryRun && !envFlag("ALLOW_LIVE_PROVIDER_CALLS")) {
    console.error("REFUSED: --live-blizzard requires ALLOW_LIVE_PROVIDER_CALLS=true");
    return 2;
  }

  const intakePath = resolve(ROOT, CANONICAL_INTAKE);
  const policyPath = resolve(ROOT, CANONICAL_POLICY);
  const intakeRaw = JSON.parse(readFileSync(intakePath, "utf8"));
  const policyRaw = JSON.parse(readFileSync(policyPath, "utf8"));

  const intakeResult = validateCohortIntake(intakeRaw);
  if (!intakeResult.ok || !intakeResult.intake) {
    console.error("INTAKE_INVALID", intakeResult.errors);
    return 1;
  }
  const policyResult = validateSeasonMetaPolicy(policyRaw);
  if (!policyResult.ok || !policyResult.policy) {
    console.error("POLICY_INVALID", policyResult.errors);
    return 1;
  }

  // Immutability: never write back to intake
  const intake = intakeResult.intake;
  const policy = policyResult.policy;

  let prisma: PrismaClient | null = null;
  let seasonBindingOk: { ok: true } | { ok: false; errors: string[] } = {
    ok: false,
    errors: ["evidence database not configured"],
  };
  const persistedByMember = new Map<string, PersistedCharacterLookup | null>();

  if (evidenceDbUrl) {
    // Guard: never silently use local DATABASE_URL for evidence authority
    const localUrl = process.env.DATABASE_URL ?? "";
    if (localUrl && evidenceDbUrl === localUrl) {
      console.error(
        "REFUSED: CALIBRATION_EVIDENCE_DATABASE_URL must point at remote test, not the local DATABASE_URL",
      );
      return 2;
    }
    prisma = createPrismaClient(evidenceDbUrl);
    const season = await loadAuthoritativeSeason(prisma);
    const binding = validateAuthoritativeSeasonBinding(policy, season);
    if (!binding.ok) {
      seasonBindingOk = binding;
      console.error("SEASON_BINDING_FAILED", binding.errors);
      await prisma.$disconnect();
      return 1;
    }
    seasonBindingOk = { ok: true };

    for (const member of intake.members) {
      const persisted = await lookupPersisted(prisma, member.region, member.realm, member.character);
      persistedByMember.set(member.id, persisted);
    }
  } else {
    console.warn(
      "WARN: no CALIBRATION_EVIDENCE_DATABASE_URL / --evidence-db-url — skipping remote Character lookup and season binding. Metadata-only Blizzard enrichment may still run.",
    );
  }

  // Deduplicate identities for Blizzard
  const uniqueIdentities = new Map<
    string,
    { region: string; realmSlug: string; name: string }
  >();
  for (const m of intake.members) {
    const key = blizzardCacheKey(m.region, m.realm, m.character);
    if (!uniqueIdentities.has(key)) {
      uniqueIdentities.set(key, {
        region: m.region,
        realmSlug: m.realm,
        name: m.character,
      });
    }
  }

  let ledger: ProviderCallLedgerEntry[] = [];
  const blizzardByKey = new Map<string, import("./resolve-member.js").BlizzardProfileEnrichment>();

  if (liveBlizzard) {
    const clientId = process.env.BLIZZARD_CLIENT_ID ?? "";
    const clientSecret = process.env.BLIZZARD_CLIENT_SECRET ?? "";
    if (!dryRun && (!clientId || !clientSecret)) {
      console.error("REFUSED: BLIZZARD_CLIENT_ID/SECRET required for live enrichment");
      if (prisma) await prisma.$disconnect();
      return 2;
    }
    const result = await enrichIdentitiesWithBlizzardProfiles([...uniqueIdentities.values()], {
      clientId,
      clientSecret,
      dryRun,
      maxAttempts: 3,
      delayMs: 400,
    });
    ledger = result.ledger;
    for (const [k, v] of result.byIdentityKey) blizzardByKey.set(k, v);
  }

  const nowIso = new Date().toISOString();
  const resolvedMembers: ResolvedMember[] = [];
  const exclusions: ExclusionRecord[] = [];
  const preflightRows: Record<string, unknown>[] = [];

  for (const member of intake.members) {
    const key = blizzardCacheKey(member.region, member.realm, member.character);
    const persisted = persistedByMember.get(member.id) ?? null;
    const blizzard = blizzardByKey.get(key) ?? null;

    // Force season exclusion if binding failed and we somehow continued
    const { resolved, exclusion } = resolveIntakeMember({
      member,
      policy,
      persisted,
      blizzard,
      nowIso,
      myzouthRecoveryComplete,
      petbearRoleContextsProvenDistinct: petbearDistinct,
    });

    if (!seasonBindingOk.ok && evidenceDbUrl) {
      resolved.exclusionReason = "SEASON_BINDING_FAILED";
      resolved.evidenceStatus = "EXCLUDED";
    }

    resolvedMembers.push(resolved);
    if (exclusion) exclusions.push(exclusion);

    preflightRows.push({
      memberId: member.id,
      identity: `${member.region}/${member.realm}/${member.character}`,
      expectedTier: member.expectedTier,
      expectedLabel: member.expectedLabel,
      characterId: resolved.characterId,
      blizzardCharacterId: resolved.blizzardCharacterId,
      providedRole: member.providedRole,
      resolvedRole: resolved.resolvedRole,
      roleMismatch: resolved.roleMismatch,
      classSlug: resolved.classSlug,
      specSlug: resolved.specSlug,
      meta: resolved.meta,
      metaPolicyId: resolved.metaPolicyId,
      seasonSlug: policy.seasonSlug,
      seasonBindingOk: seasonBindingOk.ok,
      snapshotIds: resolved.snapshotIds,
      evidenceStatus: resolved.evidenceStatus,
      identityResolutionSource: resolved.identityResolutionSource,
      exclusionReason: resolved.exclusionReason,
      providerCallsRequired: !persisted?.classSlug || !persisted?.specSlug || !persisted?.role,
      incompleteBootstrap: persisted?.incompleteBootstrap ?? null,
      boostLabelStatus: resolved.boostLabelStatus,
    });
  }

  const manifestMembers = [];
  for (const r of resolvedMembers) {
    const m = toStrictManifestMember(r);
    if (m.ok) manifestMembers.push(m.member);
  }

  const resolvedDoc = {
    schemaVersion: "agent11-resolved-v1",
    cohortId: intake.cohortId,
    generatedAt: nowIso,
    metaPolicyId: policy.policyId,
    metaPolicyEvaluatedAt: policy.evaluatedAt,
    policySeasonSlug: policy.seasonSlug,
    seasonBinding: seasonBindingOk,
    evidenceDatabaseConfigured: Boolean(evidenceDbUrl),
    liveBlizzard,
    dryRun,
    members: resolvedMembers,
  };

  const exclusionsDoc = {
    schemaVersion: "agent11-exclusions-v1",
    cohortId: intake.cohortId,
    generatedAt: nowIso,
    exclusions,
  };

  const manifestDoc = {
    schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
    cohortId: `${intake.cohortId}-strict`,
    description: "Strict CohortManifest 1.0.0 generated from Agent 11 resolved intake (expert labels preserved).",
    createdAt: intake.createdAt,
    members: manifestMembers,
    notes: `Generated ${nowIso}; excluded ${exclusions.length} members — see exclusions.v1.json`,
  };

  const preflight = {
    schemaVersion: "agent11-preflight-v1",
    generatedAt: nowIso,
    summary: {
      intakeMembers: intake.members.length,
      uniqueIdentities: uniqueIdentities.size,
      resolvedForManifest: manifestMembers.length,
      excluded: exclusions.length,
      deferred: exclusions.filter((e) => e.deferred).length,
      blizzardOk: ledger.filter((l) => l.result === "ok").length,
      blizzardErrors: ledger.filter((l) => l.result === "error" || l.result === "not_found").length,
      seasonBindingOk: seasonBindingOk.ok,
      evidenceDatabaseConfigured: Boolean(evidenceDbUrl),
    },
    members: preflightRows,
    providerCallLedger: ledger,
    intakeWarnings: intakeResult.warnings,
  };

  const cohortDir = resolve(ROOT, COHORT_DIR);
  const tmpDir = resolve(ROOT, TMP_DIR);
  mkdirSync(cohortDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  writeFileSync(resolve(cohortDir, "resolved.v1.json"), JSON.stringify(resolvedDoc, null, 2));
  writeFileSync(resolve(cohortDir, "exclusions.v1.json"), JSON.stringify(exclusionsDoc, null, 2));
  writeFileSync(resolve(cohortDir, "manifest.v1.json"), JSON.stringify(manifestDoc, null, 2));
  writeFileSync(resolve(cohortDir, "preflight.json"), JSON.stringify(preflight, null, 2));

  const preflightMd = [
    `# Agent 11 preflight — ${intake.cohortId}`,
    "",
    `Generated: ${nowIso}`,
    "",
    "## Summary",
    "",
    `- Intake members: ${preflight.summary.intakeMembers}`,
    `- Unique identities: ${preflight.summary.uniqueIdentities}`,
    `- Strict manifest members: ${preflight.summary.resolvedForManifest}`,
    `- Excluded: ${preflight.summary.excluded} (deferred: ${preflight.summary.deferred})`,
    `- Season binding: ${seasonBindingOk.ok ? "OK" : "FAILED / not configured"}`,
    `- Evidence DB configured: ${Boolean(evidenceDbUrl)}`,
    `- Live Blizzard: ${liveBlizzard} (dryRun=${dryRun})`,
    `- Meta policy: \`${policy.policyId}\` (seasonSlug=\`${policy.seasonSlug}\`)`,
    "",
    "## Provider calls",
    "",
    `| Identity | Result | Retries |`,
    `|---|---|---|`,
    ...ledger.map(
      (l) => `| ${l.characterIdentity} | ${l.result} | ${l.retryCount} |`,
    ),
    "",
    "## Members",
    "",
    `| Member | Tier | Char ID | Role (prov→res) | Class/Spec | Meta | Status | Exclusion |`,
    `|---|---|---|---|---|---|---|---|`,
    ...preflightRows.map((r) => {
      const row = r as Record<string, unknown>;
      return `| ${row.memberId} | ${row.expectedTier} | ${row.characterId ?? "—"} | ${row.providedRole ?? "∅"}→${row.resolvedRole ?? "∅"} | ${row.classSlug ?? "—"}/${row.specSlug ?? "—"} | ${row.meta} | ${row.evidenceStatus} | ${row.exclusionReason ?? ""} |`;
    }),
    "",
  ].join("\n");
  writeFileSync(resolve(cohortDir, "preflight.md"), preflightMd);
  writeFileSync(resolve(tmpDir, "provider-call-ledger.v1.json"), JSON.stringify({ generatedAt: nowIso, ledger }, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: preflight.summary,
        wrote: {
          resolved: `${COHORT_DIR}/resolved.v1.json`,
          exclusions: `${COHORT_DIR}/exclusions.v1.json`,
          manifest: `${COHORT_DIR}/manifest.v1.json`,
          preflight: `${COHORT_DIR}/preflight.json`,
          ledger: `${TMP_DIR}/provider-call-ledger.v1.json`,
        },
      },
      null,
      2,
    ),
  );

  if (prisma) await prisma.$disconnect();
  return 0;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return entry.replace(/\\/g, "/").endsWith("/calibration/cohort-enrichment-cli.ts");
  }
}

if (isMain()) {
  main().then((code) => process.exit(code));
}
