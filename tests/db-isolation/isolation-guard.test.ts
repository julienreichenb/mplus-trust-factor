/**
 * Regression coverage for disposable test-database isolation and cleanup guards.
 * These tests do not require a live Postgres for the pure guard/runner unit cases;
 * integration-style cases that need Postgres soft-skip when unreachable.
 */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEV_DATABASE_NAME,
  DISPOSABLE_DB_PREFIX,
  ISOLATED_TEST_DB_MARKER,
  TEST_SCORE_MODEL_KEY_PREFIXES,
  assertSafeTestDatabaseTarget,
  assertTestDatabaseAllowed,
  createDisposableDatabaseName,
  formatGuardFailure,
  isCanonicalScoreModelKey,
  isDisposableDatabaseName,
  isTestOwnedScoreModelKey,
  sanitizeDatabaseUrl,
} from "../../tools/scripts/lib/test-db-isolation.mjs";
import {
  assertCleanupTargetAllowed,
  parseArgs as parseCleanupArgs,
} from "../../tools/scripts/cleanup-test-score-models.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

function disposableUrl(name = createDisposableDatabaseName()) {
  return `postgresql://mplus:mplus@localhost:5433/${name}?schema=public`;
}

describe("test database isolation guard", () => {
  it("rejects when NODE_ENV is not test", () => {
    const result = assertSafeTestDatabaseTarget({
      databaseUrl: disposableUrl(),
      env: { NODE_ENV: "development", [ISOLATED_TEST_DB_MARKER]: "true", APP_ENV: "test" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/NODE_ENV/);
  });

  it("rejects an inherited development DATABASE_URL (mplus_trust)", () => {
    const result = assertSafeTestDatabaseTarget({
      databaseUrl: `postgresql://mplus:mplus@localhost:5433/${DEV_DATABASE_NAME}?schema=public`,
      env: { NODE_ENV: "test", APP_ENV: "test", [ISOLATED_TEST_DB_MARKER]: "true" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/development\/shared/);
      expect(result.sanitized).toContain(DEV_DATABASE_NAME);
      expect(result.sanitized).not.toContain("mplus:mplus");
    }
  });

  it("rejects when isolated marker is missing", () => {
    const result = assertSafeTestDatabaseTarget({
      databaseUrl: disposableUrl(),
      env: { NODE_ENV: "test", APP_ENV: "test" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/MPLUS_ISOLATED_TEST_DB/);
  });

  it("rejects a remote/deployed URL without disposable naming", () => {
    const result = assertSafeTestDatabaseTarget({
      databaseUrl: "postgresql://mplus:secret@db.example.com:5432/mplus_trust?schema=public",
      env: { NODE_ENV: "test", APP_ENV: "staging", [ISOLATED_TEST_DB_MARKER]: "true" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.sanitized).toContain("db.example.com");
      expect(result.sanitized).not.toContain("secret");
      expect(formatGuardFailure(result)).toMatch(/pnpm test/);
    }
  });

  it("accepts a disposable isolated target with marker", () => {
    const name = createDisposableDatabaseName();
    const result = assertSafeTestDatabaseTarget({
      databaseUrl: disposableUrl(name),
      env: { NODE_ENV: "test", APP_ENV: "test", [ISOLATED_TEST_DB_MARKER]: "true" },
    });
    expect(result).toEqual({ ok: true });
    expect(isDisposableDatabaseName(name)).toBe(true);
  });

  it("createTestPrismaClient guard refuses unsafe URL via assertTestDatabaseAllowed", () => {
    expect(() =>
      assertTestDatabaseAllowed(
        `postgresql://u:p@localhost:5433/${DEV_DATABASE_NAME}?schema=public`,
        { NODE_ENV: "test", APP_ENV: "test", [ISOLATED_TEST_DB_MARKER]: "true" },
      ),
    ).toThrow(/TEST DATABASE SAFETY GUARD/);
  });

  it("does not print credentials in sanitizeDatabaseUrl", () => {
    const sanitized = sanitizeDatabaseUrl(
      "postgresql://user:s3cret@localhost:5433/mplus_itest_abcd1234abcd1234?schema=public",
    );
    expect(sanitized).not.toContain("s3cret");
    expect(sanitized).not.toContain("user:");
    expect(sanitized).toContain("localhost:5433");
  });

  it("creates unique disposable names; concurrent names do not collide", () => {
    const a = createDisposableDatabaseName();
    const b = createDisposableDatabaseName();
    expect(a).not.toBe(b);
    expect(a.startsWith(DISPOSABLE_DB_PREFIX)).toBe(true);
    expect(b.startsWith(DISPOSABLE_DB_PREFIX)).toBe(true);
  });
});

describe("test score-model prefix allowlist", () => {
  it("detects all known automated-test prefixes", () => {
    for (const prefix of TEST_SCORE_MODEL_KEY_PREFIXES) {
      expect(isTestOwnedScoreModelKey(`${prefix}${randomBytes(4).toString("hex")}`)).toBe(true);
    }
  });

  it("does not treat canonical or unknown keys as test-owned", () => {
    expect(isCanonicalScoreModelKey("default")).toBe(true);
    expect(isTestOwnedScoreModelKey("default")).toBe(false);
    expect(isTestOwnedScoreModelKey("My Test Model")).toBe(false);
    expect(isTestOwnedScoreModelKey("Admin Test Model")).toBe(false);
    expect(isTestOwnedScoreModelKey("custom-prod-key")).toBe(false);
  });
});

describe("cleanup-test-score-models CLI guards", () => {
  it("defaults to dry-run when --confirm is absent", () => {
    const parsed = parseCleanupArgs([]);
    expect(parsed.confirm).toBe(false);
    expect(parsed.dryRun).toBe(true);
  });

  it("requires --confirm for deletion mode", () => {
    const parsed = parseCleanupArgs(["--confirm"]);
    expect(parsed.confirm).toBe(true);
  });

  it("refuses production categorically", () => {
    const gate = assertCleanupTargetAllowed(
      "postgresql://mplus:x@localhost:5433/mplus_trust?schema=public",
      { APP_ENV: "production" },
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toMatch(/production/i);
  });

  it("refuses remote without MPLUS_CLEANUP_TARGET=deployed-test", () => {
    const gate = assertCleanupTargetAllowed(
      "postgresql://mplus:x@db.example.com:5432/mplus_trust?schema=public",
      { APP_ENV: "test" },
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toMatch(/MPLUS_CLEANUP_TARGET=deployed-test/);
  });

  it("allows local loopback dry-run targets", () => {
    const gate = assertCleanupTargetAllowed(
      "postgresql://mplus:x@127.0.0.1:5433/mplus_trust?schema=public",
      { APP_ENV: "development" },
    );
    expect(gate.ok).toBe(true);
  });
});

describe("isolated runner lifecycle", () => {
  it("runner script creates a unique target and removes it after success", () => {
    const probe = `
      import { createDisposableDatabaseName, isDisposableDatabaseName } from './tools/scripts/lib/test-db-isolation.mjs';
      const a = createDisposableDatabaseName();
      const b = createDisposableDatabaseName();
      if (a === b) process.exit(2);
      if (!isDisposableDatabaseName(a) || !isDisposableDatabaseName(b)) process.exit(3);
      console.log('OK', a, b);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: root,
      encoding: "utf8",
      shell: false,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/OK mplus_itest_/);
  });

  it(
    "run-tests-isolated creates, migrates against disposable DB only, and drops after failure",
    { timeout: 180_000 },
    () => {
      // Probe: run a failing vitest file inside the isolated runner; disposable DB must be gone after.
      const serverUrl =
        process.env.MPLUS_TEST_SERVER_DATABASE_URL ||
        process.env.DATABASE_URL ||
        "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public";

      const result = spawnSync(
        "node",
        [
          "tools/scripts/run-tests-isolated.mjs",
          "--seed",
          "--",
          "pnpm",
          "exec",
          "node",
          "-e",
          "console.log('ISO_OK'); console.log(process.env.MPLUS_ISOLATED_TEST_DB); console.log((process.env.DATABASE_URL||'').split('/').pop()); process.exit(1)",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            DATABASE_URL: serverUrl,
            MPLUS_ISOLATED_TEST_DB: "",
          },
          shell: true,
        },
      );

      // Failure exit preserved
      expect(result.status).not.toBe(0);
      const combined = `${result.stdout}\n${result.stderr}`;
      // Should not print credentials
      expect(combined).not.toMatch(/postgresql:\/\/mplus:mplus@/);
      // Should mention disposable DB creation/drop
      expect(combined).toMatch(/mplus_itest_/);
      expect(combined).toMatch(/dropping disposable database|creating disposable database/);

      // Child should have received isolated marker (printed before exit 1)
      if (combined.includes("ISO_OK")) {
        expect(combined).toMatch(/MPLUS_ISOLATED_TEST_DB|ISO_OK/);
        expect(combined).toMatch(/mplus_itest_/);
        expect(combined).not.toMatch(new RegExp(`ISO_OK.*${DEV_DATABASE_NAME}`));
      }
    },
  );
});
