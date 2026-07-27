#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { renderAddonLua, type AddonLuaShard } from "./generate-lua.js";

interface CliOptions {
  outputDir: string;
  region: string;
  seasonSlug: string;
  modelKey: string;
  modelVersion: number;
}

function parseArgs(argv: string[]): CliOptions {
  const outputDir = argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "addon/MPlusTrust/Data";
  const region = argv.find((a) => a.startsWith("--region="))?.slice(9) ?? "EU";
  const seasonSlug = argv.find((a) => a.startsWith("--season="))?.slice(9) ?? "placeholder-current";
  const modelKey = argv.find((a) => a.startsWith("--model-key="))?.slice(12) ?? "default";
  const modelVersion = Number(argv.find((a) => a.startsWith("--model-version="))?.slice(16) ?? "1");
  return { outputDir, region, seasonSlug, modelKey, modelVersion };
}

/** Reads JSON entries from stdin or uses a minimal fixture cohort when empty. */
async function readEntries(): Promise<AddonLuaShard["entries"]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return [
      { region: "EU", realmSlug: "tarren-mill", normalizedName: "aleria", grade: "A", overallScore: 88, confidence: 0.78 },
      { region: "EU", realmSlug: "kazzak", normalizedName: "carryme", grade: "C", overallScore: 54, confidence: 0.62 },
    ];
  }
  const parsed = JSON.parse(raw) as { entries: AddonLuaShard["entries"] };
  return parsed.entries;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const entries = await readEntries();
  const checksum = createHash("sha256")
    .update(JSON.stringify({ entries, generatedAt, opts }))
    .digest("hex");

  const shard: AddonLuaShard = {
    formatVersion: "v1",
    generatedAt,
    region: opts.region,
    seasonSlug: opts.seasonSlug,
    modelKey: opts.modelKey,
    modelVersion: opts.modelVersion,
    checksum,
    entries,
  };

  const lua = renderAddonLua(shard);
  const outDir = resolve(process.cwd(), opts.outputDir);
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "MPlusTrustData.lua");
  writeFileSync(outFile, lua, "utf8");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        output: outFile,
        characterCount: entries.length,
        checksum,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", message: String(error) }, null, 2));
  process.exitCode = 1;
});
