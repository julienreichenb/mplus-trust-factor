/**
 * Import Agent 11 (or any) cohort intake JSON into CalibrationCohort tables.
 *
 * Usage:
 *   pnpm calibration:cohort-import -- --file doc/scoring/cohorts/agent11-2026-08-01/intake.v1.json --season <uuid-or-slug>
 *
 * Idempotent via intake.cohortId as CalibrationCohort.externalKey.
 * Never calls providers. Never infers expert labels from scores.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@mplus/database";
import type { CalibrationExpectedLabel } from "@mplus/contracts";
import { CALIBRATION_TIER_TO_LABEL } from "@mplus/contracts";

const ROOT = resolve(import.meta.dirname, "../../../../../");
const DEFAULT_INTAKE = "doc/scoring/cohorts/agent11-2026-08-01/intake.v1.json";
const DEFAULT_EXCLUSIONS = "doc/scoring/cohorts/agent11-2026-08-01/exclusions.v1.json";

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

function mapLabel(raw: unknown, tier: unknown): CalibrationExpectedLabel {
  if (
    raw === "excellent" ||
    raw === "good" ||
    raw === "average" ||
    raw === "weak" ||
    raw === "overrated"
  ) {
    return raw.toUpperCase() as CalibrationExpectedLabel;
  }
  if (typeof tier === "string" && tier in CALIBRATION_TIER_TO_LABEL) {
    return CALIBRATION_TIER_TO_LABEL[tier as keyof typeof CALIBRATION_TIER_TO_LABEL];
  }
  throw new Error(`Cannot map expected label from ${String(raw)} / tier ${String(tier)}`);
}

interface ExclusionRow {
  memberId: string;
  reason: string;
  detail?: string;
  deferred?: boolean;
}

export async function importCohortFromIntake(opts: {
  prisma: PrismaClient;
  intakePath: string;
  exclusionsPath: string | null;
  seasonIdOrSlug: string;
  createdByUserId: string;
  dryRun?: boolean;
}): Promise<{ cohortId: string; created: boolean; memberCount: number; revision: number }> {
  const intake = JSON.parse(readFileSync(opts.intakePath, "utf8")) as {
    cohortId: string;
    description?: string;
    members: Array<Record<string, unknown>>;
  };
  if (!intake.cohortId || !Array.isArray(intake.members)) {
    throw new Error("Invalid intake: cohortId and members[] required");
  }

  const exclusions = new Map<string, ExclusionRow>();
  if (opts.exclusionsPath && existsSync(opts.exclusionsPath)) {
    const raw = JSON.parse(readFileSync(opts.exclusionsPath, "utf8")) as {
      exclusions?: ExclusionRow[];
    };
    for (const row of raw.exclusions ?? []) {
      exclusions.set(row.memberId, row);
    }
  }

  let season = await opts.prisma.season.findUnique({ where: { id: opts.seasonIdOrSlug } });
  if (!season) {
    season = await opts.prisma.season.findFirst({ where: { slug: opts.seasonIdOrSlug } });
  }
  if (!season) {
    throw new Error(`Season not found: ${opts.seasonIdOrSlug}`);
  }

  const existing = await opts.prisma.calibrationCohort.findUnique({
    where: { externalKey: intake.cohortId },
    include: { members: true },
  });

  if (opts.dryRun) {
    return {
      cohortId: existing?.id ?? "(dry-run)",
      created: !existing,
      memberCount: intake.members.length,
      revision: existing?.revision ?? 1,
    };
  }

  if (existing) {
    // Idempotent: refresh members by externalMemberKey without changing expert labels from scores.
    await opts.prisma.$transaction(async (tx) => {
      for (const m of intake.members) {
        const memberId = String(m.id);
        const excl = exclusions.get(memberId);
        const data = {
          region: String(m.region),
          realmSlug: String(m.realm),
          characterName: String(m.character),
          expectedLabel: mapLabel(m.expectedLabel, m.expectedTier),
          providedRole: (m.providedRole === "TANK" || m.providedRole === "HEALER" || m.providedRole === "DPS"
            ? m.providedRole
            : null) as "DPS" | "TANK" | "HEALER" | null,
          classSlug: typeof m.classSlug === "string" ? m.classSlug : null,
          specSlug: typeof m.specSlug === "string" ? m.specSlug : null,
          rationale: typeof m.rationale === "string" ? m.rationale : "Imported study member",
          source: "IMPORTED_STUDY" as const,
          included: !excl,
          exclusionCode: excl?.reason ?? null,
          exclusionDetail: excl?.detail ?? null,
        };
        const found = existing.members.find((row) => row.externalMemberKey === memberId);
        if (found) {
          await tx.calibrationCohortMember.update({ where: { id: found.id }, data });
        } else {
          await tx.calibrationCohortMember.create({
            data: {
              id: randomUUID(),
              cohortId: existing.id,
              externalMemberKey: memberId,
              ...data,
            },
          });
        }
      }
      await tx.calibrationCohort.update({
        where: { id: existing.id },
        data: {
          description: intake.description ?? existing.description,
          seasonId: season!.id,
          revision: { increment: 1 },
        },
      });
    });
    const refreshed = await opts.prisma.calibrationCohort.findUniqueOrThrow({
      where: { id: existing.id },
      include: { _count: { select: { members: true } } },
    });
    return {
      cohortId: refreshed.id,
      created: false,
      memberCount: refreshed._count.members,
      revision: refreshed.revision,
    };
  }

  const cohortId = randomUUID();
  await opts.prisma.$transaction(async (tx) => {
    await tx.calibrationCohort.create({
      data: {
        id: cohortId,
        name: intake.cohortId,
        description: intake.description ?? "",
        seasonId: season!.id,
        status: "READY",
        revision: 1,
        externalKey: intake.cohortId,
        createdByUserId: opts.createdByUserId,
      },
    });
    for (const m of intake.members) {
      const memberId = String(m.id);
      const excl = exclusions.get(memberId);
      await tx.calibrationCohortMember.create({
        data: {
          id: randomUUID(),
          cohortId,
          externalMemberKey: memberId,
          region: String(m.region),
          realmSlug: String(m.realm),
          characterName: String(m.character),
          expectedLabel: mapLabel(m.expectedLabel, m.expectedTier),
          providedRole: (m.providedRole === "TANK" || m.providedRole === "HEALER" || m.providedRole === "DPS"
            ? m.providedRole
            : null) as "DPS" | "TANK" | "HEALER" | null,
          classSlug: typeof m.classSlug === "string" ? m.classSlug : null,
          specSlug: typeof m.specSlug === "string" ? m.specSlug : null,
          rationale: typeof m.rationale === "string" ? m.rationale : "Imported study member",
          source: "IMPORTED_STUDY",
          included: !excl,
          exclusionCode: excl?.reason ?? null,
          exclusionDetail: excl?.detail ?? null,
        },
      });
    }
  });

  return {
    cohortId,
    created: true,
    memberCount: intake.members.length,
    revision: 1,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  loadEnvFile(resolve(ROOT, ".env"));
  const { flags, values } = parseArgs(argv);
  const file = values.get("file") ?? DEFAULT_INTAKE;
  const season = values.get("season");
  if (!season) {
    console.error("Required: --season <uuid-or-slug>");
    return 2;
  }
  const intakePath = resolve(ROOT, file);
  const exclusionsPath = values.has("exclusions")
    ? resolve(ROOT, values.get("exclusions")!)
    : resolve(ROOT, DEFAULT_EXCLUSIONS);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    return 2;
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    const user =
      (process.env.ADMIN_BOOTSTRAP_USER_ID
        ? await prisma.user.findUnique({ where: { id: process.env.ADMIN_BOOTSTRAP_USER_ID } })
        : null) ?? (await prisma.user.findFirst({ orderBy: { createdAt: "asc" } }));
    if (!user) {
      console.error("No user found for createdByUserId attribution");
      return 2;
    }
    const result = await importCohortFromIntake({
      prisma,
      intakePath,
      exclusionsPath: existsSync(exclusionsPath) ? exclusionsPath : null,
      seasonIdOrSlug: season,
      createdByUserId: user.id,
      dryRun: flags.has("dry-run"),
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => process.exit(code));
}
