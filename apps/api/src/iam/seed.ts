import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import {
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
  ROLE_KEYS,
  type PermissionKey,
} from "./permissions.js";

/** Idempotent seed of default roles and permissions. Safe to call on API boot. */
export async function ensureIamSeed(prisma: PrismaClient): Promise<void> {
  const allPermissions = [...new Set([...DEFAULT_USER_PERMISSIONS, ...DEFAULT_ADMIN_PERMISSIONS])];

  for (const key of allPermissions) {
    await upsertIgnoringUniqueRace(async () => {
      await prisma.permission.upsert({
        where: { key },
        create: { id: randomUUID(), key, description: key },
        update: {},
      });
    });
  }

  const userRole = await upsertIgnoringUniqueRace(async () =>
    prisma.role.upsert({
      where: { key: ROLE_KEYS.USER },
      create: {
        id: randomUUID(),
        key: ROLE_KEYS.USER,
        name: "User",
        description: "Authenticated Battle.net user with least privilege",
      },
      update: {},
    }),
  );

  const adminRole = await upsertIgnoringUniqueRace(async () =>
    prisma.role.upsert({
      where: { key: ROLE_KEYS.ADMIN },
      create: {
        id: randomUUID(),
        key: ROLE_KEYS.ADMIN,
        name: "Admin",
        description: "Administrative role with explicit elevated permissions",
      },
      update: {},
    }),
  );

  // Concurrent seeds can lose the create race; re-read by key so sync always has rows.
  const resolvedUser =
    userRole ?? (await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.USER } }));
  const resolvedAdmin =
    adminRole ?? (await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.ADMIN } }));

  await syncRolePermissions(prisma, resolvedUser.id, DEFAULT_USER_PERMISSIONS);
  await syncRolePermissions(prisma, resolvedAdmin.id, DEFAULT_ADMIN_PERMISSIONS);
}

/** Prisma upsert create races on unique keys under concurrent API boots/tests. */
async function upsertIgnoringUniqueRace<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      return null;
    }
    throw err;
  }
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

async function syncRolePermissions(
  prisma: PrismaClient,
  roleId: string,
  keys: PermissionKey[],
): Promise<void> {
  const permissions = await prisma.permission.findMany({ where: { key: { in: keys } } });
  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId, permissionId: permission.id },
      },
      create: { roleId, permissionId: permission.id },
      update: {},
    });
  }
}
