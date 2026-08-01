#!/usr/bin/env node
/**
 * Manual WCL planner probes. Requires ALLOW_LIVE_PROVIDER_CALLS=true.
 * Never invoked by CI. Outputs sanitized JSON under tmp/ (gitignored).
 *
 *   ALLOW_LIVE_PROVIDER_CALLS=true pnpm wcl:probe:planner
 */
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = join(
  here,
  "..",
  "..",
  "packages",
  "providers",
  "warcraftlogs",
  "dist",
  "planner",
  "probes",
  "planner-probes.js",
);
const srcFallbackHint =
  "Build @mplus/provider-warcraftlogs first (pnpm --filter @mplus/provider-warcraftlogs build), then re-run.";

async function main() {
  if (process.env.ALLOW_LIVE_PROVIDER_CALLS !== "true") {
    console.error(
      "REFUSED: planner probes require ALLOW_LIVE_PROVIDER_CALLS=true (never enable this in CI).",
    );
    process.exit(2);
  }

  let mod;
  try {
    mod = await import(pathToFileURL(distEntry).href);
  } catch (err) {
    console.error(srcFallbackHint);
    console.error(err);
    process.exit(1);
  }

  const outputDir = join(here, "../../tmp/wcl-planner-probes");
  const { results, wrote } = mod.runPlannerProbeSuite({ outputDir });
  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        cases: results.map((r) => ({ caseId: r.caseId, ok: r.ok, notes: r.notes })),
        wrote,
      },
      null,
      2,
    ),
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
