/**
 * Regression coverage for deterministic disposable-database teardown.
 * Soft-skips live Postgres cases when the local/CI server is unreachable.
 */
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  createDisposableDatabaseName,
  isDisposableDatabaseName,
  rewriteDatabaseUrl,
  sanitizeDatabaseUrl,
  toMaintenanceDatabaseUrl,
} from "../../tools/scripts/lib/test-db-isolation.mjs";
import {
  createDatabase,
  dropDatabase,
  quoteDisposableIdent,
  resolveAdminUrl,
  resolveWrapperExitCode,
  sanitizePgError,
} from "../../tools/scripts/run-tests-isolated.mjs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const { Client } = pg;

const serverUrl =
  process.env.MPLUS_TEST_SERVER_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public";

async function canReachPostgres() {
  const adminUrl = toMaintenanceDatabaseUrl(serverUrl);
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const dbAvailable = await canReachPostgres();

async function databaseExists(name) {
  const { adminUrl } = resolveAdminUrl(serverUrl, name);
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
    const result = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [name]);
    return result.rowCount === 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

describe("dropDatabase guards (pure)", () => {
  it("refuses non-generated database names", async () => {
    await expect(dropDatabase(serverUrl, "mplus_trust")).rejects.toThrow(/non-disposable/);
    await expect(dropDatabase(serverUrl, "postgres")).rejects.toThrow(/non-disposable/);
    await expect(dropDatabase(serverUrl, "mplus_itest_SHORT")).rejects.toThrow(/non-disposable/);
  });

  it("quoteDisposableIdent only accepts disposable names", () => {
    const name = createDisposableDatabaseName();
    expect(quoteDisposableIdent(name)).toBe(`"${name}"`);
    expect(() => quoteDisposableIdent("mplus_trust")).toThrow(/non-disposable/);
  });

  it("resolveAdminUrl never targets the disposable database", () => {
    const name = createDisposableDatabaseName();
    const { adminUrl, adminDatabase } = resolveAdminUrl(serverUrl, name);
    expect(adminDatabase).not.toBe(name);
    expect(isDisposableDatabaseName(adminDatabase)).toBe(false);
    expect(sanitizeDatabaseUrl(adminUrl)).not.toContain("mplus:mplus");
    expect(sanitizeDatabaseUrl(adminUrl)).toMatch(/\/postgres\?/);
  });

  it("sanitizePgError never echoes credentials", () => {
    const err = new Error("connect to postgresql://mplus:secret@db.example.com:5432/x failed");
    /** @type {Error & { code?: string }} */ (err).code = "08001";
    const safe = sanitizePgError(err);
    expect(safe).toMatch(/SQLSTATE 08001/);
    expect(safe).toContain("postgresql://***@");
    expect(safe).not.toContain("secret");
  });

  it("resolveWrapperExitCode preserves child failure and fails on cleanup error", () => {
    expect(resolveWrapperExitCode(0, { ok: true })).toBe(0);
    expect(resolveWrapperExitCode(7, { ok: true })).toBe(7);
    expect(resolveWrapperExitCode(0, { ok: false })).toBe(1);
    expect(resolveWrapperExitCode(7, { ok: false })).toBe(7);
  });
});

describe.skipIf(!dbAvailable)("dropDatabase against live PostgreSQL 16", () => {
  const created = [];

  afterAll(async () => {
    for (const name of created) {
      try {
        await dropDatabase(serverUrl, name);
      } catch {
        // best-effort suite teardown for leaked fixtures only
      }
    }
  });

  it("successful create+drop removes the disposable database", async () => {
    const name = createDisposableDatabaseName();
    created.push(name);
    await createDatabase(serverUrl, name);
    expect(await databaseExists(name)).toBe(true);
    const result = await dropDatabase(serverUrl, name);
    expect(result.ok).toBe(true);
    expect(await databaseExists(name)).toBe(false);
  });

  it("terminates a lingering session then drops the database", async () => {
    const name = createDisposableDatabaseName();
    created.push(name);
    await createDatabase(serverUrl, name);

    const disposableUrl = rewriteDatabaseUrl(serverUrl, name, "public");
    const hold = new Client({ connectionString: disposableUrl });
    // Termination emits async client errors — swallow so Vitest does not treat them as unhandled.
    hold.on("error", () => undefined);
    await hold.connect();
    await hold.query("SELECT 1");

    const result = await dropDatabase(serverUrl, name);
    expect(result.ok).toBe(true);
    expect(await databaseExists(name)).toBe(false);

    await hold.end().catch(() => undefined);
  });

  it("cleanup is idempotent (second drop is a no-op success)", async () => {
    const name = createDisposableDatabaseName();
    created.push(name);
    await createDatabase(serverUrl, name);
    await dropDatabase(serverUrl, name);
    const again = await dropDatabase(serverUrl, name);
    expect(again.ok).toBe(true);
    expect(await databaseExists(name)).toBe(false);
  });

  it("concurrent runs use distinct names and both clean up", async () => {
    const a = createDisposableDatabaseName();
    const b = createDisposableDatabaseName();
    expect(a).not.toBe(b);
    created.push(a, b);
    await Promise.all([createDatabase(serverUrl, a), createDatabase(serverUrl, b)]);
    expect(await databaseExists(a)).toBe(true);
    expect(await databaseExists(b)).toBe(true);
    await Promise.all([dropDatabase(serverUrl, a), dropDatabase(serverUrl, b)]);
    expect(await databaseExists(a)).toBe(false);
    expect(await databaseExists(b)).toBe(false);
  });
});

describe.skipIf(!dbAvailable)("run-tests-isolated wrapper exit + cleanup", () => {
  function runIsolated(childExit, extraEnv = {}) {
    return spawnSync(
      process.execPath,
      [
        "tools/scripts/run-tests-isolated.mjs",
        "--no-migrate",
        "--no-seed",
        "--",
        process.execPath,
        "tests/db-isolation/fixtures/iso-child-exit.mjs",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          APP_ENV: "test",
          NODE_ENV: "test",
          DATABASE_URL: serverUrl,
          MPLUS_TEST_SERVER_DATABASE_URL: serverUrl,
          MPLUS_TEST_SERVER_CONFIRMED: "true",
          MPLUS_ISOLATED_TEST_DB: "",
          MPLUS_ISO_CHILD_EXIT: String(childExit),
          ...extraEnv,
        },
        shell: false,
      },
    );
  }

  it("successful command removes disposable DB and exits 0", { timeout: 60_000 }, async () => {
    const result = runIsolated(0);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(0);
    expect(combined).toMatch(/creating disposable database (mplus_itest_[a-z0-9]+)/);
    expect(combined).toMatch(/dropping disposable database/);
    expect(combined).toMatch(/ISO_OK/);
    expect(combined).not.toMatch(/postgresql:\/\/mplus:mplus@/);
    const match = combined.match(/creating disposable database (mplus_itest_[a-z0-9]+)/);
    expect(match).toBeTruthy();
    if (match) expect(await databaseExists(match[1])).toBe(false);
  });

  it("failing command still removes disposable DB and preserves failure code", { timeout: 60_000 }, async () => {
    const result = runIsolated(3);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(3);
    expect(combined).toMatch(/dropping disposable database/);
    expect(combined).not.toMatch(/postgresql:\/\/mplus:mplus@/);
    const match = combined.match(/creating disposable database (mplus_itest_[a-z0-9]+)/);
    expect(match).toBeTruthy();
    if (match) expect(await databaseExists(match[1])).toBe(false);
  });

  it("cleanup failure makes an otherwise successful wrapper fail", () => {
    // Pure contract: when drop reports failure, exit must be non-zero even if child was 0.
    expect(resolveWrapperExitCode(0, { ok: false, error: "DROP failed" })).toBe(1);
  });
});
