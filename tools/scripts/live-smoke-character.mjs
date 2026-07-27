#!/usr/bin/env node
/**
 * Manual multi-provider character smoke (bounded, redacted).
 * Requires ALLOW_LIVE_PROVIDER_CALLS=true.
 * Usage:
 *   pnpm live:smoke:character -- --region EU --realm tarren-mill --name Example
 *
 * Runs Blizzard → Raider.IO → WCL connectivity checks for one identity.
 * Does not implement provider business logic; delegates to per-provider smokes.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assertLiveCallsAllowed, requireIdentityArgs, printEnvModeSummary, printRedacted, envFlag } from "./live-smoke-lib.mjs";

assertLiveCallsAllowed();
printEnvModeSummary();

const identity = requireIdentityArgs();
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const identityArgs = ["--region", identity.region, "--realm", identity.realm, "--name", identity.name];

const steps = [
  { name: "blizzard", file: "live-smoke-blizzard.mjs", enabled: envFlag(process.env.BLIZZARD_ENABLED, true) },
  { name: "raiderio", file: "live-smoke-raiderio.mjs", enabled: envFlag(process.env.RAIDERIO_ENABLED, true) },
  { name: "wcl", file: "live-smoke-wcl.mjs", enabled: envFlag(process.env.WCL_ENABLED, true) },
];

/**
 * @param {string} scriptFile
 * @returns {Promise<number>}
 */
function runSmoke(scriptFile) {
  return new Promise((resolveExit) => {
    const child = spawn(process.execPath, [resolve(scriptsDir, scriptFile), ...identityArgs], {
      env: process.env,
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
}

const results = [];
for (const step of steps) {
  if (!step.enabled) {
    results.push({ provider: step.name, status: "skipped", reason: "disabled" });
    continue;
  }
  console.log(`\n--- ${step.name} ---`);
  const code = await runSmoke(step.file);
  results.push({ provider: step.name, status: code === 0 ? "ok" : "failed", exitCode: code });
  if (code !== 0) {
    printRedacted("character.smoke.summary", { identity, results });
    process.exit(code);
  }
}

printRedacted("character.smoke.summary", { identity, results });
console.log("OK");
