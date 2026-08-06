#!/usr/bin/env node
/**
 * Live Scoring V2 character probe CLI (worker package entry).
 *
 *   pnpm --filter @mplus/worker exec tsx src/orchestration/scoring/live-character-probe/cli.ts --region eu --realm archimonde --name Wallidrixe
 */

import {
  parseProbeArgs,
  runScoringLiveCharacterProbe,
} from "./pipeline.js";

async function main(): Promise<void> {
  let args: ReturnType<typeof parseProbeArgs>;
  try {
    args = parseProbeArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const { outputDir, overallVerdict } = await runScoringLiveCharacterProbe(args);
  console.log(
    JSON.stringify(
      {
        ok: true,
        character: `${args.region}/${args.realm}/${args.name}`,
        overallVerdict,
        outputDir,
        publication: false,
        scoringFlagsEnabled: false,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
