/**
 * Regression coverage for shared vs destructive integration suite isolation.
 * Pure/unit: no live Postgres required.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DESTRUCTIVE_INTEGRATION_FILES } from "../../vitest.integration.destructive-files.ts";
import sharedConfig from "../../vitest.integration.config.ts";
import destructiveConfig from "../../vitest.integration.destructive.config.ts";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

describe("destructive integration isolation", () => {
  it("lists only audited whole-database destructive files", () => {
    expect(DESTRUCTIVE_INTEGRATION_FILES).toEqual([
      "packages/database/src/identity-data-reset.integration.test.ts",
    ]);
    for (const file of DESTRUCTIVE_INTEGRATION_FILES) {
      expect(existsSync(resolve(root, file))).toBe(true);
    }
  });

  it("shared config excludes destructive files; destructive config includes them", () => {
    const sharedExclude = sharedConfig.test?.exclude ?? [];
    const sharedInclude = sharedConfig.test?.include ?? [];
    const destructiveInclude = destructiveConfig.test?.include ?? [];

    expect(sharedInclude).toContain("**/*.integration.test.ts");
    for (const file of DESTRUCTIVE_INTEGRATION_FILES) {
      expect(sharedExclude).toContain(file);
      expect(destructiveInclude).toContain(file);
    }
    expect(destructiveConfig.test?.fileParallelism).toBe(false);
  });

  it("package.json chains shared then destructive with && via separate isolated runners", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const shared = pkg.scripts["test:integration:shared"];
    const destructive = pkg.scripts["test:integration:destructive"];
    const aggregate = pkg.scripts["test:integration"];

    expect(shared).toMatch(/run-tests-isolated\.mjs/);
    expect(shared).toMatch(/vitest\.integration\.config\.ts/);
    expect(shared).not.toMatch(/destructive\.config/);

    expect(destructive).toMatch(/run-tests-isolated\.mjs/);
    expect(destructive).toMatch(/vitest\.integration\.destructive\.config\.ts/);

    expect(aggregate).toBe(
      "pnpm run test:integration:shared && pnpm run test:integration:destructive",
    );
  });

  it("&& chain semantics propagate first-group and second-group failures", () => {
    /** Mirrors `cmdA && cmdB` without shell quoting differences across platforms. */
    function runAndChain(exitCodes: number[]): number {
      for (const code of exitCodes) {
        const result = spawnSync(process.execPath, ["-e", `process.exit(${code})`], {
          encoding: "utf8",
          shell: false,
        });
        const status = result.status ?? 1;
        if (status !== 0) return status;
      }
      return 0;
    }

    expect(runAndChain([7, 0])).toBe(7);
    expect(runAndChain([0, 9])).toBe(9);
    expect(runAndChain([0, 0])).toBe(0);
  });
});
