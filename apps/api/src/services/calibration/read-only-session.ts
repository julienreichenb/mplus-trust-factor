/**
 * PostgreSQL READ ONLY session probes for calibration evidence join.
 *
 * CREATE TEMP TABLE is NOT valid proof — PG allows temporary-table work in READ ONLY
 * transactions. Proof requires SQLSTATE 25006 on a zero-row UPDATE of a real
 * application table (`regions`).
 */
import type { Prisma, PrismaClient } from "@mplus/database";

export type Tx = Prisma.TransactionClient;

/** Prisma Region @@map("regions") — table the runtime DB role can normally UPDATE. */
export const READ_ONLY_PROBE_UPDATE_SQL = `UPDATE "regions" SET "code" = "code" WHERE FALSE`;

export function extractPostgresSqlState(error: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (value: unknown): string | null => {
    if (value == null || seen.has(value)) return null;
    if (typeof value !== "object") return null;
    seen.add(value);

    const record = value as Record<string, unknown>;
    for (const key of ["code", "sqlState", "sqlstate"] as const) {
      const raw = record[key];
      if (typeof raw === "string" && /^[0-9A-Z]{5}$/i.test(raw)) {
        // Prisma P2010 etc. are not PG SQLSTATEs — only accept 5-char PG codes when they look numeric-ish.
        // Accept any 5-char alnum; callers require exact 25006.
        return raw.toUpperCase();
      }
    }

    if (record.meta && typeof record.meta === "object") {
      const meta = record.meta as Record<string, unknown>;
      if (typeof meta.code === "string" && /^[0-9A-Z]{5}$/i.test(meta.code)) {
        return meta.code.toUpperCase();
      }
    }

    for (const nestedKey of ["cause", "original", "error", "driverError"] as const) {
      const nested = walk(record[nestedKey]);
      if (nested) return nested;
    }

    if (typeof record.message === "string") {
      const m = record.message.match(/\b(25006)\b/);
      if (m?.[1]) return m[1];
    }
    return null;
  };
  return walk(error);
}

/** Prefer the PostgreSQL SQLSTATE over Prisma client codes (P2xxx). */
export function extractPostgresSqlStatePreferPg(error: unknown): string | null {
  const seen = new Set<unknown>();
  const candidates: string[] = [];
  const walk = (value: unknown): void => {
    if (value == null || seen.has(value)) return;
    if (typeof value !== "object") return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ["code", "sqlState", "sqlstate"] as const) {
      const raw = record[key];
      if (typeof raw === "string" && /^[0-9A-Z]{5}$/i.test(raw)) {
        candidates.push(raw.toUpperCase());
      }
    }
    if (record.meta && typeof record.meta === "object") {
      const meta = record.meta as Record<string, unknown>;
      if (typeof meta.code === "string" && /^[0-9A-Z]{5}$/i.test(meta.code)) {
        candidates.push(meta.code.toUpperCase());
      }
    }
    for (const nestedKey of ["cause", "original", "error", "driverError"] as const) {
      walk(record[nestedKey]);
    }
    if (typeof record.message === "string") {
      const m = record.message.match(/\b(25006)\b/);
      if (m?.[1]) candidates.push(m[1]);
    }
  };
  walk(error);
  if (candidates.includes("25006")) return "25006";
  // Ignore Prisma P-codes
  return candidates.find((c) => !/^P\d{4}$/i.test(c)) ?? null;
}

export async function showTransactionReadOnly(tx: Tx): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ transaction_read_only: string }>>`
    SHOW transaction_read_only
  `;
  return String(rows[0]?.transaction_read_only ?? "").toLowerCase();
}

class ReadOnlyProbeOk extends Error {
  readonly transactionReadOnly: string;
  readonly sqlState = "25006" as const;
  constructor(transactionReadOnly: string) {
    super("READ_ONLY_PROBE_OK");
    this.name = "ReadOnlyProbeOk";
    this.transactionReadOnly = transactionReadOnly;
  }
}

/**
 * Dedicated probe transaction:
 * 1. SET TRANSACTION READ ONLY
 * 2. SHOW transaction_read_only === on
 * 3. UPDATE regions ... WHERE FALSE → must fail with SQLSTATE 25006
 * 4. Discard/rollback the probe transaction
 *
 * Permission denied (or any non-25006) is NOT accepted as proof.
 */
export async function probeReadOnlySqlTransaction(prisma: PrismaClient): Promise<{
  transactionReadOnly: string;
  sqlState: "25006";
}> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const transactionReadOnly = await showTransactionReadOnly(tx);
        if (transactionReadOnly !== "on") {
          throw new Error(
            `REFUSED: probe SHOW transaction_read_only must be "on" (got: ${JSON.stringify(transactionReadOnly)})`,
          );
        }

        let writeError: unknown = null;
        try {
          await tx.$executeRawUnsafe(READ_ONLY_PROBE_UPDATE_SQL);
        } catch (error) {
          writeError = error;
        }

        if (writeError == null) {
          throw new Error(
            "READ_ONLY_ENFORCEMENT_FAILED: zero-row UPDATE on regions succeeded inside READ ONLY transaction",
          );
        }

        const sqlState = extractPostgresSqlStatePreferPg(writeError);
        if (sqlState !== "25006") {
          throw new Error(
            `REFUSED: expected PostgreSQL SQLSTATE 25006 (read_only_sql_transaction); got ${JSON.stringify(sqlState)}. Permission denied or other failures are not accepted as proof.`,
          );
        }

        // Abort probe transaction after successful proof (no lasting side effects).
        throw new ReadOnlyProbeOk(transactionReadOnly);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof ReadOnlyProbeOk) {
      return { transactionReadOnly: error.transactionReadOnly, sqlState: "25006" };
    }
    throw error;
  }

  throw new Error(
    "READ_ONLY_ENFORCEMENT_FAILED: probe transaction completed without observing SQLSTATE 25006",
  );
}

/**
 * Evidence-join transaction: SET READ ONLY + verify SHOW. No write probe here.
 * Caller must perform every evidence query on `tx` — never the root Prisma client.
 */
export async function beginReadOnlyEvidenceTransaction<T>(
  prisma: PrismaClient,
  run: (tx: Tx, transactionReadOnly: string) => Promise<T>,
): Promise<{ result: T; transactionReadOnly: string }> {
  let transactionReadOnly = "";
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      transactionReadOnly = await showTransactionReadOnly(tx);
      if (transactionReadOnly !== "on") {
        throw new Error(
          `REFUSED: evidence SHOW transaction_read_only must be "on" (got: ${JSON.stringify(transactionReadOnly)})`,
        );
      }
      return run(tx, transactionReadOnly);
    },
    { maxWait: 15_000, timeout: 120_000 },
  );
  return { result, transactionReadOnly };
}
