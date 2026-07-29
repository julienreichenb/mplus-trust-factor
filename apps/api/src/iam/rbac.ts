import type { PrismaClient } from "@mplus/database";
import type { PermissionKey } from "./permissions.js";

export async function loadUserPermissionKeys(
  prisma: PrismaClient,
  userId: string,
): Promise<Set<PermissionKey>> {
  const now = new Date();
  const assignments = await prisma.userRoleAssignment.findMany({
    where: {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });

  const keys = new Set<PermissionKey>();
  for (const assignment of assignments) {
    for (const rp of assignment.role.permissions) {
      keys.add(rp.permission.key as PermissionKey);
    }
  }
  return keys;
}

export function hasPermission(permissions: Set<string>, required: PermissionKey | PermissionKey[]): boolean {
  const needed = Array.isArray(required) ? required : [required];
  return needed.every((key) => permissions.has(key));
}
