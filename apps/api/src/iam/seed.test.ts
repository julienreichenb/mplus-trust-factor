import { describe, expect, it } from "vitest";
import { deterministicIamId, ensureIamSeed } from "./seed.js";
import { DEFAULT_ADMIN_PERMISSIONS, DEFAULT_USER_PERMISSIONS, ROLE_KEYS } from "./permissions.js";

describe("deterministic IAM seed", () => {
  it("produces stable UUIDs for the same seed", () => {
    expect(deterministicIamId("permission:admin.users.read")).toBe(
      deterministicIamId("permission:admin.users.read"),
    );
    expect(deterministicIamId("permission:a")).not.toBe(deterministicIamId("permission:b"));
  });

  it("survives concurrent ensureIamSeed without unique violations", async () => {
    const permissions = new Map<string, { id: string; key: string; description: string }>();
    const roles = new Map<string, { id: string; key: string; name: string; description: string }>();
    const rolePermissions = new Set<string>();

    const prisma = {
      permission: {
        createMany: async ({ data }: { data: Array<{ id: string; key: string; description: string }> }) => {
          for (const row of data) {
            if (![...permissions.values()].some((p) => p.key === row.key || p.id === row.id)) {
              permissions.set(row.id, row);
            }
          }
          return { count: data.length };
        },
        findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
          [...permissions.values()].filter((p) => where.key.in.includes(p.key)),
      },
      role: {
        createMany: async ({
          data,
        }: {
          data: Array<{ id: string; key: string; name: string; description: string }>;
        }) => {
          for (const row of data) {
            if (![...roles.values()].some((r) => r.key === row.key || r.id === row.id)) {
              roles.set(row.id, row);
            }
          }
          return { count: data.length };
        },
        findUniqueOrThrow: async ({ where }: { where: { key: string } }) => {
          const row = [...roles.values()].find((r) => r.key === where.key);
          if (!row) throw new Error(`missing role ${where.key}`);
          return row;
        },
      },
      rolePermission: {
        createMany: async ({ data }: { data: Array<{ roleId: string; permissionId: string }> }) => {
          for (const row of data) {
            rolePermissions.add(`${row.roleId}:${row.permissionId}`);
          }
          return { count: data.length };
        },
      },
    };

    await Promise.all([
      ensureIamSeed(prisma as never),
      ensureIamSeed(prisma as never),
      ensureIamSeed(prisma as never),
    ]);

    expect(roles.size).toBe(2);
    expect(roles.has(deterministicIamId(`role:${ROLE_KEYS.USER}`))).toBe(true);
    expect(roles.has(deterministicIamId(`role:${ROLE_KEYS.ADMIN}`))).toBe(true);

    const expectedPerms = new Set([...DEFAULT_USER_PERMISSIONS, ...DEFAULT_ADMIN_PERMISSIONS]);
    expect(permissions.size).toBe(expectedPerms.size);
    for (const key of expectedPerms) {
      expect(permissions.has(deterministicIamId(`permission:${key}`))).toBe(true);
    }

    expect(rolePermissions.size).toBeGreaterThan(0);
  });
});
