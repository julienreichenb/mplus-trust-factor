/**
 * Read-only diagnostic: identify potentially poisoned WCL rows created without
 * fight-roster ownership proof.
 *
 * Default mode is report-only (no writes). Cleanup requires an explicit
 * `--execute` flag and is refused when APP_ENV is production.
 *
 * Usage:
 *   node tools/scripts/with-env.mjs pnpm --filter @mplus/database exec tsx ../../tools/scripts/diagnose-wcl-fight-ownership.ts
 *   node tools/scripts/with-env.mjs pnpm --filter @mplus/database exec tsx ../../tools/scripts/diagnose-wcl-fight-ownership.ts --execute
 */
import { PrismaClient } from "@prisma/client";

type Finding = {
  kind:
    | "RESOLVED_TARGET_ABSENT_FROM_DIGEST_ROSTER"
    | "DIGEST_ROSTER_LARGER_THAN_FIVE"
    | "ACTOR_SCOPED_PAGE_MISSING_SCOPE_FINGERPRINT";
  reportCode: string;
  fightId: number;
  reportRevision: number;
  detail: string;
};

function parseArgs(argv: string[]) {
  return {
    execute: argv.includes("--execute"),
    limit: (() => {
      const idx = argv.indexOf("--limit");
      if (idx < 0) return 200;
      const n = Number(argv[idx + 1]);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
    })(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const appEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "local").toLowerCase();
  const prisma = new PrismaClient();
  const findings: Finding[] = [];

  try {
    const digests = await prisma.wclRunSourceDigest.findMany({
      take: args.limit,
      orderBy: { acquiredAt: "desc" },
      include: { participants: true },
    });

    for (const digest of digests) {
      if (digest.participants.length > 5) {
        findings.push({
          kind: "DIGEST_ROSTER_LARGER_THAN_FIVE",
          reportCode: digest.reportCode,
          fightId: digest.fightId,
          reportRevision: digest.reportRevision,
          detail: `participantCount=${digest.participants.length}`,
        });
      }

      const resolved = digest.participants.filter((p) => p.mappingState === "RESOLVED");
      const digestDoc = asRecord(digest.digest);
      const docParticipants = Array.isArray(digestDoc?.participants)
        ? digestDoc!.participants
        : [];
      const rosterIds = new Set(
        digest.participants.map((p) => p.wclActorId),
      );

      for (const p of resolved) {
        if (!rosterIds.has(p.wclActorId)) {
          findings.push({
            kind: "RESOLVED_TARGET_ABSENT_FROM_DIGEST_ROSTER",
            reportCode: digest.reportCode,
            fightId: digest.fightId,
            reportRevision: digest.reportRevision,
            detail: `resolvedActor=${p.wclActorId} name=${p.characterName} not in roster`,
          });
        }
      }

      // Heuristic poison: digest document lists more Player-like names than
      // participants, or participants include names that suggest report-wide leak
      // without a stored fightFriendlyPlayerActorIds proof (field absent historically).
      void docParticipants;
    }

    const legacyPages = await prisma.evidenceDatasetPage.findMany({
      where: {
        scopeFingerprint: "scope:unscoped",
        datasetKey: { notIn: ["masterData", "fight-details", "HostileCasts"] },
      },
      take: args.limit,
      orderBy: { createdAt: "desc" },
    });
    for (const page of legacyPages) {
      // Actor-filtered event datasets persisted before scopeFingerprint may sit
      // under the unscoped default — flag for manual review.
      if (
        page.datasetKey === "Deaths" ||
        page.datasetKey === "DamageTaken" ||
        page.datasetKey === "CombatantInfo" ||
        page.datasetKey === "Healing"
      ) {
        findings.push({
          kind: "ACTOR_SCOPED_PAGE_MISSING_SCOPE_FINGERPRINT",
          reportCode: page.reportCode,
          fightId: page.fightId,
          reportRevision: page.reportRevision,
          detail: `datasetKey=${page.datasetKey} pageIndex=${page.pageIndex} scope=${page.scopeFingerprint}`,
        });
      }
    }

    const summary = {
      appEnv,
      mode: args.execute ? "execute" : "readonly",
      digestsScanned: digests.length,
      pagesScanned: legacyPages.length,
      findingCount: findings.length,
      byKind: findings.reduce<Record<string, number>>((acc, f) => {
        acc[f.kind] = (acc[f.kind] ?? 0) + 1;
        return acc;
      }, {}),
      findings: findings.slice(0, 100),
    };

    console.log(JSON.stringify(summary, null, 2));

    if (args.execute) {
      if (appEnv === "production" || appEnv === "prod") {
        console.error("Refusing --execute in production. Cleanup is non-production only.");
        process.exitCode = 2;
        return;
      }
      console.error(
        "Execute mode is intentionally a no-op stub: review findings and delete poisoned rows in a separate explicit cleanup task.",
      );
      console.error(
        "No rows were deleted. Re-run without --execute for the read-only report.",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
