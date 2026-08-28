/**
 * Export durable AbilityCatalogSourceBaseline snapshot bytes for --previous-simc.
 * Verifies SHA-256 against baseline.contentHash. No mutation.
 *
 * Usage:
 *   pnpm ability-catalog:baseline:export -- --baseline-id <uuid> --out previous-simc.json
 *   pnpm ability-catalog:baseline:export -- --active --source SIMULATIONCRAFT --out previous-simc.json
 */

import { mkdirSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "@mplus/database";
import { AbilityCatalogReviewService } from "../services/ability-catalog-review-service.js";

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function parseArgs(argv: string[]) {
  const out: { baselineId?: string; out?: string; active?: boolean; source?: string; json?: boolean } =
    {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--baseline-id") out.baselineId = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--active") out.active = true;
    else if (a === "--source") out.source = argv[++i];
    else if (a === "--json") out.json = true;
  }
  return out;
}

function writeAtomic(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    throw new Error("Missing --out <path>");
  }
  const repoRoot = findRepoRoot(fileURLToPath(new URL(".", import.meta.url)));
  const outPath = isAbsolute(args.out) ? args.out : resolve(repoRoot, args.out);

  const prisma = createPrismaClient();
  const service = new AbilityCatalogReviewService(prisma);
  try {
    let baselineId = args.baselineId;
    if (!baselineId && args.active) {
      const active = await service.getActiveBaseline(args.source ?? "SIMULATIONCRAFT");
      if (!active) {
        throw new Error("No active AbilityCatalogSourceBaseline found");
      }
      baselineId = active.id;
    }
    if (!baselineId) {
      throw new Error("Provide --baseline-id <uuid> or --active [--source SIMULATIONCRAFT|BLIZZARD]");
    }

    const exported = await service.exportBaselinePayload(baselineId);
    const hash = createHash("sha256").update(exported.bytes).digest("hex");
    if (hash !== exported.contentHash.toLowerCase()) {
      throw new Error(`BASELINE_DIGEST_MISMATCH: computed ${hash} != ${exported.contentHash}`);
    }
    writeAtomic(outPath, exported.bytes);
    const result = {
      ok: true as const,
      baselineId: exported.baselineId,
      contentHash: exported.contentHash,
      source: exported.source,
      sourceRevision: exported.sourceRevision,
      bytes: exported.bytes.byteLength,
      out: outPath,
    };
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        `Exported baseline ${result.baselineId} (${result.sourceRevision.slice(0, 12)}) → ${result.out} [${result.contentHash.slice(0, 12)}…]`,
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
