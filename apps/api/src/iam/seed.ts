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
    await prisma.permission.upsert({
      where: { key },
      create: { id: randomUUID(), key, description: key },
      update: {},
    });
  }

  const userRole = await prisma.role.upsert({
    where: { key: ROLE_KEYS.USER },
    create: {
      id: randomUUID(),
      key: ROLE_KEYS.USER,
      name: "User",
      description: "Authenticated Battle.net user with least privilege",
    },
    update: {},
  });

  const adminRole = await prisma.role.upsert({
    where: { key: ROLE_KEYS.ADMIN },
    create: {
      id: randomUUID(),
      key: ROLE_KEYS.ADMIN,
      name: "Admin",
      description: "Administrative role with explicit elevated permissions",
    },
    update: {},
  });

  await syncRolePermissions(prisma, userRole.id, DEFAULT_USER_PERMISSIONS);
  await syncRolePermissions(prisma, adminRole.id, DEFAULT_ADMIN_PERMISSIONS);
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
