import { createHash } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import {
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
  ROLE_KEYS,
  type PermissionKey,
} from "./permissions.js";

/** Deterministic UUID from a stable seed (idempotent across concurrent seeds). */
export function deterministicIamId(seed: string): string {
  const digest = createHash("sha256").update(`mplus-iam-v1:${seed}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Idempotent seed of default roles and permissions.
 * Uses deterministic IDs + createMany(skipDuplicates) so concurrent suite
 * boots never race on random UUID creates for the same logical key.
 */
export async function ensureIamSeed(prisma: PrismaClient): Promise<void> {
  const allPermissions = [...new Set([...DEFAULT_USER_PERMISSIONS, ...DEFAULT_ADMIN_PERMISSIONS])];

  await prisma.permission.createMany({
    data: allPermissions.map((key) => ({
      id: deterministicIamId(`permission:${key}`),
      key,
      description: key,
    })),
    skipDuplicates: true,
  });

  await prisma.role.createMany({
    data: [
      {
        id: deterministicIamId(`role:${ROLE_KEYS.USER}`),
        key: ROLE_KEYS.USER,
        name: "User",
        description: "Authenticated Battle.net user with least privilege",
      },
      {
        id: deterministicIamId(`role:${ROLE_KEYS.ADMIN}`),
        key: ROLE_KEYS.ADMIN,
        name: "Admin",
        description: "Administrative role with explicit elevated permissions",
      },
    ],
    skipDuplicates: true,
  });

  const userRole = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.USER } });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.ADMIN } });

  await syncRolePermissions(prisma, userRole.id, DEFAULT_USER_PERMISSIONS);
  await syncRolePermissions(prisma, adminRole.id, DEFAULT_ADMIN_PERMISSIONS);
}

async function syncRolePermissions(
  prisma: PrismaClient,
  roleId: string,
  keys: PermissionKey[],
): Promise<void> {
  const permissions = await prisma.permission.findMany({ where: { key: { in: keys } } });
  if (permissions.length === 0) return;
  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });
}
