#!/usr/bin/env node
/**
 * Promote origin/main → origin/test by fast-forward only (no force, no merge).
 *
 * Usage:
 *   node tools/scripts/promote-test.mjs
 *   node tools/scripts/promote-test.mjs --dry-run
 *   pnpm promote:test
 *   pnpm promote:test -- --dry-run
 *
 * Cross-platform (Windows PowerShell, Linux, macOS) via Node.js + git.
 */
import { spawnSync } from "node:child_process";

const DRY_RUN = process.argv.includes("--dry-run") || process.argv.includes("-n");

function fail(message) {
  console.error(`promote:test ERROR: ${message}`);
  process.exit(1);
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    shell: false,
  });
  if (result.error) {
    fail(`git ${args.join(" ")} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    fail(`git ${args.join(" ")} exited ${result.status}${stderr ? `\n${stderr}` : ""}${stdout ? `\n${stdout}` : ""}`);
  }
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function resolveSha(ref) {
  const { stdout } = git(["rev-parse", "--verify", `${ref}^{commit}`]);
  return stdout;
}

console.log(DRY_RUN ? "promote:test (dry-run)" : "promote:test");

git(["fetch", "origin", "--prune"]);

const mainExists = git(["rev-parse", "--verify", "refs/remotes/origin/main"], { allowFailure: true });
if (mainExists.status !== 0) {
  fail("origin/main not found after fetch");
}

const mainSha = resolveSha("refs/remotes/origin/main");
const testRef = git(["rev-parse", "--verify", "refs/remotes/origin/test"], { allowFailure: true });
const testExists = testRef.status === 0;
const testSha = testExists ? resolveSha("refs/remotes/origin/test") : null;

if (testExists) {
  const ancestor = git(["merge-base", "--is-ancestor", "refs/remotes/origin/test", "refs/remotes/origin/main"], {
    allowFailure: true,
  });
  if (ancestor.status !== 0) {
    fail(
      `origin/test (${testSha}) is not an ancestor of origin/main (${mainSha}). ` +
        "Refusing divergent history — do not force-push test.",
    );
  }
  if (testSha === mainSha) {
    console.log(`origin/test already at origin/main (${mainSha}) — nothing to promote`);
    process.exit(0);
  }
}

console.log(`current test SHA : ${testExists ? testSha : "(branch does not exist yet)"}`);
console.log(`promote main SHA : ${mainSha}`);

if (DRY_RUN) {
  console.log("dry-run: would push refs/remotes/origin/main:refs/heads/test (no force)");
  process.exit(0);
}

const push = git(["push", "origin", "refs/remotes/origin/main:refs/heads/test"], { allowFailure: true });
if (push.status !== 0) {
  fail(
    `fast-forward push to test failed (exit ${push.status}). ` +
      "Non-fast-forward updates are refused — investigate divergent history; never force-push.",
  );
}

console.log(`promoted test → ${mainSha}`);
console.log("Track CD with:");
console.log("  gh run list --workflow CD --branch test --event push --limit 3");
