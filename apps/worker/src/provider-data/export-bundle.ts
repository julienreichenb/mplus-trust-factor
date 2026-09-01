import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { PrismaClient } from "@mplus/database";
import { buildManifest, buildProviderDataCorpus } from "./build-corpus.js";
import { canonicalJsonStringify } from "./canonical.js";

export async function exportProviderDataBundle(input: {
  prisma: PrismaClient;
  outputDir: string;
  sourceEnvironment: string;
}): Promise<{
  manifestPath: string;
  payloadPath: string;
  contentHash: string;
  counts: Record<string, number>;
}> {
  const { corpus, contentHash, counts, regions, seasonIds } = await buildProviderDataCorpus(
    input.prisma,
  );
  const manifest = buildManifest({
    contentHash,
    sourceEnvironment: input.sourceEnvironment,
    regions,
    seasonIds,
    counts,
  });

  await mkdir(input.outputDir, { recursive: true });
  const payloadTmp = join(input.outputDir, `latest.json.gz.tmp-${process.pid}`);
  const manifestTmp = join(input.outputDir, `manifest.json.tmp-${process.pid}`);
  const payloadPath = join(input.outputDir, "latest.json.gz");
  const manifestPath = join(input.outputDir, "manifest.json");

  const gzipped = gzipSync(Buffer.from(canonicalJsonStringify(corpus), "utf8"), { level: 9 });
  await writeFile(payloadTmp, gzipped);
  await writeFile(manifestTmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(payloadTmp, payloadPath);
  await rename(manifestTmp, manifestPath);

  return { manifestPath, payloadPath, contentHash, counts };
}
