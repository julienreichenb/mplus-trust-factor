import type { Prisma, PrismaClient } from "@mplus/database";

/** Either the top-level Prisma client or a transaction client; repositories accept both. */
export type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;
