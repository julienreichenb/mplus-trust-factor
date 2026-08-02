#!/usr/bin/env tsx
/**
 * Export / import calibration cohort expected labels (pre-reset safety net).
 *
 *   pnpm db:calibration-labels:export -- --out=./calibration-labels.json
 *   pnpm db:calibration-labels:import -- --in=./calibration-labels.json
 */

import { readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

type LabelExportV1 = {
  schemaVersion: "calibration-labels/v1";
  exportedAt: string;
  cohorts: Array<{
    externalKey: string | null;
    name: string;
    seasonSlug: string;
    status: string;
    members: Array<{
      externalMemberKey: string | null;
      region: string;
      realmSlug: string;
      characterName: string;
      expectedLabel: string;
      providedRole: string | null;
      classSlug: string | null;
      specSlug: string | null;
      rationale: string;
      source: string;
      included: boolean;
    }>;
  }>;
};

function parseArgs(argv: string[]) {
  const out: { mode: "export" | "import"; file: string | null } = {
    mode: "export",
    file: null,
  };
  for (const arg of argv) {
    if (arg === "export" || arg === "import") out.mode = arg;
    else if (arg.startsWith("--out=")) {
      out.mode = "export";
      out.file = arg.slice("--out=".length);
    } else if (arg.startsWith("--in=")) {
      out.mode = "import";
      out.file = arg.slice("--in=".length);
    }
  }
  return out;
}

async function exportLabels(prisma: PrismaClient, file: string): Promise<void> {
  const cohorts = await prisma.calibrationCohort.findMany({
    include: {
      season: true,
      members: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const payload: LabelExportV1 = {
    schemaVersion: "calibration-labels/v1",
    exportedAt: new Date().toISOString(),
    cohorts: cohorts.map((c) => ({
      externalKey: c.externalKey,
      name: c.name,
      seasonSlug: c.season.slug,
      status: c.status,
      members: c.members.map((m) => ({
        externalMemberKey: m.externalMemberKey,
        region: m.region,
        realmSlug: m.realmSlug,
        characterName: m.characterName,
        expectedLabel: m.expectedLabel,
        providedRole: m.providedRole,
        classSlug: m.classSlug,
        specSlug: m.specSlug,
        rationale: m.rationale,
        source: m.source,
        included: m.included,
      })),
    })),
  };

  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Exported ${payload.cohorts.length} cohort(s) → ${file}`);
}

async function importLabels(prisma: PrismaClient, file: string): Promise<void> {
  const raw = JSON.parse(await readFile(file, "utf8")) as LabelExportV1;
  if (raw.schemaVersion !== "calibration-labels/v1") {
    throw new Error(`Unsupported schemaVersion: ${String(raw.schemaVersion)}`);
  }

  let updatedMembers = 0;
  for (const cohort of raw.cohorts) {
    const existing = cohort.externalKey
      ? await prisma.calibrationCohort.findUnique({ where: { externalKey: cohort.externalKey } })
      : await prisma.calibrationCohort.findFirst({ where: { name: cohort.name } });
    if (!existing) {
      console.warn(`Skipping missing cohort: ${cohort.name}`);
      continue;
    }
    for (const member of cohort.members) {
      const where = member.externalMemberKey
        ? {
            cohortId_externalMemberKey: {
              cohortId: existing.id,
              externalMemberKey: member.externalMemberKey,
            },
          }
        : null;
      if (!where) {
        const row = await prisma.calibrationCohortMember.findFirst({
          where: {
            cohortId: existing.id,
            region: member.region,
            realmSlug: member.realmSlug,
            characterName: member.characterName,
          },
        });
        if (!row) continue;
        await prisma.calibrationCohortMember.update({
          where: { id: row.id },
          data: {
            expectedLabel: member.expectedLabel as never,
            rationale: member.rationale,
            included: member.included,
          },
        });
        updatedMembers += 1;
        continue;
      }
      await prisma.calibrationCohortMember.update({
        where,
        data: {
          expectedLabel: member.expectedLabel as never,
          rationale: member.rationale,
          included: member.included,
        },
      });
      updatedMembers += 1;
    }
  }
  console.log(`Imported labels for ${updatedMembers} member(s) from ${file}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error("Usage: export --out=<file> | import --in=<file>");
    process.exit(2);
  }
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  try {
    if (args.mode === "export") await exportLabels(prisma, args.file);
    else await importLabels(prisma, args.file);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
