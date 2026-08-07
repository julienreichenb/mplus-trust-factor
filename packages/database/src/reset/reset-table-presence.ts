import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * True when `public.<table>` exists as a base or partitioned table.
 * Used by reset planners so absent configured tables can be skipped safely.
 */
export async function postgresPublicTableExists(
  prisma: DbClient,
  table: string,
): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = $1
         AND c.relkind IN ('r', 'p')
     ) AS "exists"`,
    table,
  );
  return Boolean(rows[0]?.exists);
}

/**
 * Count rows when the table exists; otherwise report missing without throwing.
 */
export async function countTableIfExists(
  prisma: DbClient,
  table: string,
): Promise<{ exists: boolean; rowCount: number | null }> {
  if (!(await postgresPublicTableExists(prisma, table))) {
    return { exists: false, rowCount: null };
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
  );
  const raw = rows[0]?.count ?? 0;
  return {
    exists: true,
    rowCount: typeof raw === "bigint" ? Number(raw) : Number(raw),
  };
}

/** Status/probe COUNT that returns 0 when the relation is absent. */
export async function countRawIfTableExists(
  prisma: DbClient,
  table: string,
  sql: string,
): Promise<number> {
  if (!(await postgresPublicTableExists(prisma, table))) {
    return 0;
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(sql);
  const raw = rows[0]?.count ?? 0;
  return typeof raw === "bigint" ? Number(raw) : Number(raw);
}
