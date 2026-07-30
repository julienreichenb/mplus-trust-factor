import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import { HttpError } from "../errors.js";
import { writeAuditEvent } from "../iam/audit.js";
import { BATTLENET_PROVIDER, ROLE_KEYS } from "../iam/permissions.js";
import { ensureIamSeed } from "../iam/seed.js";

const MANAGEABLE_ROLE_KEYS = new Set<string>([ROLE_KEYS.USER, ROLE_KEYS.ADMIN]);

/** Pure last-admin guard — extracted for deterministic unit tests. */
export function assertCanRevokeAdminRole(
  activeAdminCount: number,
  allowLastAdminRemoval: boolean,
): void {
  if (activeAdminCount <= 1 && !allowLastAdminRemoval) {
    throw HttpError.conflict(
      "LAST_ADMIN_PROTECTION",
      "Cannot revoke the last active admin without allowLastAdminRemoval=true",
      { activeAdminCount },
    );
  }
}

export interface AdminUserListItem {
  id: string;
  displayName: string | null;
  email: string | null;
  disabledAt: string | null;
  roles: string[];
  battlenet: {
    subject: string | null;
    battletag: string | null;
  };
}

export interface AdminUserSearchResult {
  users: AdminUserListItem[];
  query: string;
  limit: number;
}

export interface RoleMutationResult {
  userId: string;
  roleKey: string;
  roles: string[];
  alreadyHadRole?: boolean;
  alreadyMissingRole?: boolean;
}

export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessionSecret: string,
  ) {}

  async searchUsers(query: string, limit = 25): Promise<AdminUserSearchResult> {
    await ensureIamSeed(this.prisma);
    const q = query.trim();
    if (q.length < 2) {
      throw HttpError.badRequest("QUERY_TOO_SHORT", "Search query must be at least 2 characters");
    }
    const take = Math.min(Math.max(limit, 1), 50);
    const like = { contains: q, mode: "insensitive" as const };

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { email: like },
          { displayName: like },
          { battleNetAccounts: { some: { battletagDisplay: like, unlinkedAt: null } } },
          { externalIdentities: { some: { provider: BATTLENET_PROVIDER, displayName: like } } },
        ],
      },
      take,
      orderBy: { createdAt: "desc" },
      include: {
        roleAssignments: {
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          include: { role: true },
        },
        battleNetAccounts: {
          where: { unlinkedAt: null },
          orderBy: { linkedAt: "desc" },
          take: 1,
        },
        externalIdentities: {
          where: { provider: BATTLENET_PROVIDER },
          take: 1,
        },
      },
    });

    return {
      query: q,
      limit: take,
      users: users.map((user) => this.mapUser(user)),
    };
  }

  async getUser(userId: string): Promise<AdminUserListItem> {
    await ensureIamSeed(this.prisma);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roleAssignments: {
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          include: { role: true },
        },
        battleNetAccounts: {
          where: { unlinkedAt: null },
          orderBy: { linkedAt: "desc" },
          take: 1,
        },
        externalIdentities: {
          where: { provider: BATTLENET_PROVIDER },
          take: 1,
        },
      },
    });
    if (!user) {
      throw HttpError.notFound("USER_NOT_FOUND", `User ${userId} was not found`);
    }
    return this.mapUser(user);
  }

  async listManageableRoles(): Promise<Array<{ key: string; name: string; description: string | null }>> {
    await ensureIamSeed(this.prisma);
    const roles = await this.prisma.role.findMany({
      where: { key: { in: [...MANAGEABLE_ROLE_KEYS] } },
      orderBy: { key: "asc" },
    });
    return roles.map((role) => ({
      key: role.key,
      name: role.name,
      description: role.description,
    }));
  }

  async grantRole(input: {
    actorUserId: string | null;
    actorType: "user" | "admin_key";
    targetUserId: string;
    roleKey: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<RoleMutationResult> {
    await ensureIamSeed(this.prisma);
    this.assertManageableRole(input.roleKey);

    const role = await this.prisma.role.findUnique({ where: { key: input.roleKey } });
    if (!role) {
      throw HttpError.notFound("ROLE_NOT_FOUND", `Role ${input.roleKey} was not found`);
    }

    const target = await this.prisma.user.findUnique({ where: { id: input.targetUserId } });
    if (!target) {
      throw HttpError.notFound("USER_NOT_FOUND", `User ${input.targetUserId} was not found`);
    }

    const existing = await this.prisma.userRoleAssignment.findUnique({
      where: { userId_roleId: { userId: target.id, roleId: role.id } },
    });

    if (!existing) {
      await this.prisma.userRoleAssignment.create({
        data: { id: randomUUID(), userId: target.id, roleId: role.id },
      });
      if (input.roleKey === ROLE_KEYS.ADMIN) {
        await this.prisma.user.update({ where: { id: target.id }, data: { role: "ADMIN" } });
      }
    }

    await writeAuditEvent(this.prisma, {
      userId: input.actorUserId,
      actorType: input.actorType,
      action: existing ? "admin.users.grant_role.idempotent" : "admin.users.grant_role",
      resourceType: "user",
      resourceId: target.id,
      outcome: "SUCCESS",
      ip: input.ip,
      userAgent: input.userAgent,
      sessionSecret: this.sessionSecret,
      metadata: {
        targetUserId: target.id,
        roleKey: input.roleKey,
        alreadyHadRole: Boolean(existing),
      },
    });

    const updated = await this.getUser(target.id);
    return {
      userId: target.id,
      roleKey: input.roleKey,
      roles: updated.roles,
      alreadyHadRole: Boolean(existing),
    };
  }

  async revokeRole(input: {
    actorUserId: string | null;
    actorType: "user" | "admin_key";
    targetUserId: string;
    roleKey: string;
    allowLastAdminRemoval?: boolean;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<RoleMutationResult> {
    await ensureIamSeed(this.prisma);
    this.assertManageableRole(input.roleKey);

    const role = await this.prisma.role.findUnique({ where: { key: input.roleKey } });
    if (!role) {
      throw HttpError.notFound("ROLE_NOT_FOUND", `Role ${input.roleKey} was not found`);
    }

    const target = await this.prisma.user.findUnique({ where: { id: input.targetUserId } });
    if (!target) {
      throw HttpError.notFound("USER_NOT_FOUND", `User ${input.targetUserId} was not found`);
    }

    const existing = await this.prisma.userRoleAssignment.findUnique({
      where: { userId_roleId: { userId: target.id, roleId: role.id } },
    });

    if (existing && input.roleKey === ROLE_KEYS.ADMIN) {
      const activeAdminCount = await this.countActiveAdmins();
      assertCanRevokeAdminRole(activeAdminCount, Boolean(input.allowLastAdminRemoval));
    }

    if (existing) {
      await this.prisma.userRoleAssignment.delete({
        where: { userId_roleId: { userId: target.id, roleId: role.id } },
      });
      if (input.roleKey === ROLE_KEYS.ADMIN) {
        await this.prisma.user.update({ where: { id: target.id }, data: { role: "USER" } });
      }
    }

    await writeAuditEvent(this.prisma, {
      userId: input.actorUserId,
      actorType: input.actorType,
      action: existing ? "admin.users.revoke_role" : "admin.users.revoke_role.idempotent",
      resourceType: "user",
      resourceId: target.id,
      outcome: "SUCCESS",
      ip: input.ip,
      userAgent: input.userAgent,
      sessionSecret: this.sessionSecret,
      metadata: {
        targetUserId: target.id,
        roleKey: input.roleKey,
        alreadyMissingRole: !existing,
        allowLastAdminRemoval: Boolean(input.allowLastAdminRemoval),
      },
    });

    const updated = await this.getUser(target.id);
    return {
      userId: target.id,
      roleKey: input.roleKey,
      roles: updated.roles,
      alreadyMissingRole: !existing,
    };
  }

  async countActiveAdmins(): Promise<number> {
    const adminRole = await this.prisma.role.findUnique({ where: { key: ROLE_KEYS.ADMIN } });
    if (!adminRole) return 0;
    return this.prisma.userRoleAssignment.count({
      where: {
        roleId: adminRole.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        user: { disabledAt: null },
      },
    });
  }

  private assertManageableRole(roleKey: string): void {
    if (!MANAGEABLE_ROLE_KEYS.has(roleKey)) {
      throw HttpError.badRequest(
        "ROLE_NOT_MANAGEABLE",
        `Role ${roleKey} cannot be granted or revoked via admin user management`,
      );
    }
  }

  private mapUser(user: {
    id: string;
    displayName: string | null;
    email: string | null;
    disabledAt: Date | null;
    roleAssignments: Array<{ role: { key: string } }>;
    battleNetAccounts: Array<{ providerAccountId: string; battletagDisplay: string | null }>;
    externalIdentities: Array<{ subject: string }>;
  }): AdminUserListItem {
    const account = user.battleNetAccounts[0];
    const identity = user.externalIdentities[0];
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      disabledAt: user.disabledAt?.toISOString() ?? null,
      roles: [...new Set(user.roleAssignments.map((a) => a.role.key))].sort(),
      battlenet: {
        subject: identity?.subject ?? account?.providerAccountId ?? null,
        battletag: account?.battletagDisplay ?? null,
      },
    };
  }
}
