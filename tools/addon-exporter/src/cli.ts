#!/usr/bin/env node
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";
import { runBenchmarkSuite } from "./benchmark.js";
import { getDefaultPaths, runExport } from "./export.js";

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function packageAddon(): Promise<{ zipPath: string }> {
  const { addonDir, repoRoot } = getDefaultPaths();
  const toc = readFileSync(join(addonDir, "MPlusTrust.toc"), "utf8");
  const versionMatch = toc.match(/^## Version:\s*(.+)$/m);
  const version = versionMatch?.[1]?.trim() ?? "0.0.0";
  const distDir = join(TOOL_ROOT, "dist");
  mkdirSync(distDir, { recursive: true });
  const zipPath = join(distDir, `MPlusTrust-${version}.zip`);

  await new Promise<void>((resolvePromise, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolvePromise());
    archive.on("error", (error) => reject(error));
    archive.pipe(output);
    archive.directory(addonDir, "MPlusTrust");
    void archive.finalize();
  });

  return { zipPath: zipPath.replace(repoRoot + "\\", "").replace(repoRoot + "/", "") };
}

async function main(): Promise<void> {
  const [command = "export", ...args] = process.argv.slice(2);

  if (command === "export") {
    const generatedAt = args[0] ?? "2026-07-27T09:00:00.000Z";
    const result = runExport({ generatedAt });
    printJson({
      status: "ok",
      command: "export",
      characterCount: result.meta.characterCount,
      shardCount: result.shardFiles.length,
      checksum: result.meta.checksum,
      formatVersion: result.meta.formatVersion,
      region: result.meta.region,
      season: result.meta.seasonSlug,
      scoreModel: `${result.meta.scoreModelKey}@${result.meta.scoreModelVersion}`,
    });
    return;
  }

  if (command === "benchmark") {
    const generatedAt = args[0] ?? "2026-07-27T09:00:00.000Z";
    const results = runBenchmarkSuite(generatedAt);
    const reportPath = join(TOOL_ROOT, "dist", "benchmark-report.json");
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify({ generatedAt, results }, null, 2));
    printJson({ status: "ok", command: "benchmark", results, reportPath });
    return;
  }

  if (command === "package") {
    runExport({ generatedAt: "2026-07-27T09:00:00.000Z" });
    const { zipPath } = await packageAddon();
    printJson({ status: "ok", command: "package", zipPath });
    return;
  }

  printJson({
    status: "error",
    message: "Unknown command. Use: export | benchmark | package",
  });
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  printJson({ status: "error", message });
  process.exitCode = 1;
});
