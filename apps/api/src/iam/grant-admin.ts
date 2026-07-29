import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import { writeAuditEvent } from "./audit.js";
import { BATTLENET_PROVIDER, ROLE_KEYS } from "./permissions.js";
import { ensureIamSeed } from "./seed.js";

export type GrantAdminLookup =
  | { kind: "userId"; userId: string }
  | { kind: "battlenetSubject"; subject: string };

export interface GrantAdminResult {
  alreadyAdmin: boolean;
  userId: string;
  displayName: string | null;
  battlenetSubject: string | null;
  battlenetAccountId: string | null;
  roleKey: string;
}

/**
 * Promote exactly one existing authenticated user to the admin role.
 * Lookup is immutable-id only: local user UUID or Battle.net provider subject.
 */
export async function grantAdminRole(
  prisma: PrismaClient,
  lookup: GrantAdminLookup,
  options: { sessionSecret: string; actorLabel?: string } = { sessionSecret: "cli" },
): Promise<GrantAdminResult> {
  await ensureIamSeed(prisma);

  const user = await resolveExactUser(prisma, lookup);
  const identity = await prisma.externalIdentity.findFirst({
    where: { userId: user.id, provider: BATTLENET_PROVIDER },
  });
  const account = await prisma.battleNetAccount.findFirst({
    where: { userId: user.id, unlinkedAt: null },
    orderBy: { linkedAt: "desc" },
  });

  const adminRole = await prisma.role.findUnique({ where: { key: ROLE_KEYS.ADMIN } });
  if (!adminRole) {
    throw Object.assign(new Error("Admin role missing after IAM seed"), { code: "ADMIN_ROLE_MISSING" });
  }

  const existing = await prisma.userRoleAssignment.findUnique({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
  });

  if (!existing) {
    await prisma.userRoleAssignment.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        roleId: adminRole.id,
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { role: "ADMIN" },
    });
  }

  await writeAuditEvent(prisma, {
    userId: user.id,
    actorType: "system",
    action: existing ? "iam.grant_admin.idempotent" : "iam.grant_admin",
    resourceType: "user",
    resourceId: user.id,
    outcome: "SUCCESS",
    sessionSecret: options.sessionSecret,
    metadata: {
      actorLabel: options.actorLabel ?? "cli",
      lookup,
      battlenetSubject: identity?.subject ?? null,
      battlenetAccountId: account?.providerAccountId ?? null,
      alreadyAdmin: Boolean(existing),
    },
  });

  return {
    alreadyAdmin: Boolean(existing),
    userId: user.id,
    displayName: user.displayName,
    battlenetSubject: identity?.subject ?? account?.providerAccountId ?? null,
    battlenetAccountId: account?.providerAccountId ?? null,
    roleKey: ROLE_KEYS.ADMIN,
  };
}

async function resolveExactUser(prisma: PrismaClient, lookup: GrantAdminLookup) {
  if (lookup.kind === "userId") {
    const userId = lookup.userId.trim();
    if (!userId) {
      throw Object.assign(new Error("user-id must be a non-empty UUID"), { code: "INVALID_USER_ID" });
    }
    const matches = await prisma.user.findMany({ where: { id: userId } });
    if (matches.length === 0) {
      throw Object.assign(new Error(`No user found for id ${userId}`), { code: "USER_NOT_FOUND" });
    }
    if (matches.length > 1) {
      throw Object.assign(new Error("Ambiguous user id match"), { code: "AMBIGUOUS_USER" });
    }
    return matches[0]!;
  }

  const subject = lookup.subject.trim();
  if (!subject) {
    throw Object.assign(new Error("battlenet-subject must be a non-empty provider account id"), {
      code: "INVALID_BNET_SUBJECT",
    });
  }

  const identities = await prisma.externalIdentity.findMany({
    where: { provider: BATTLENET_PROVIDER, subject },
    include: { user: true },
  });
  if (identities.length === 0) {
    // Fallback: BattleNetAccount.providerAccountId (same durable id).
    const accounts = await prisma.battleNetAccount.findMany({
      where: { providerAccountId: subject },
      include: { user: true },
    });
    if (accounts.length === 0) {
      throw Object.assign(new Error(`No Battle.net identity found for subject ${subject}`), {
        code: "BNET_SUBJECT_NOT_FOUND",
      });
    }
    if (accounts.length > 1) {
      throw Object.assign(new Error("Ambiguous Battle.net account subject match"), {
        code: "AMBIGUOUS_BNET_SUBJECT",
      });
    }
    return accounts[0]!.user;
  }
  if (identities.length > 1) {
    throw Object.assign(new Error("Ambiguous Battle.net subject match"), {
      code: "AMBIGUOUS_BNET_SUBJECT",
    });
  }
  return identities[0]!.user;
}
