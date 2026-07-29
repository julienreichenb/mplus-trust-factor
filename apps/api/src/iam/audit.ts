import type { AuditOutcome, PrismaClient } from "@mplus/database";
import { randomUUID } from "node:crypto";
import { hashIdentifier } from "./crypto.js";

export interface AuditInput {
  userId?: string | null;
  actorType: "user" | "admin_key" | "system" | "anonymous";
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome?: AuditOutcome;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  sessionSecret: string;
}

export async function writeAuditEvent(prisma: PrismaClient, input: AuditInput): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      id: randomUUID(),
      userId: input.userId ?? null,
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome ?? "SUCCESS",
      ipHash: input.ip ? hashIdentifier(input.ip, input.sessionSecret) : null,
      userAgentHash: input.userAgent ? hashIdentifier(input.userAgent, input.sessionSecret) : null,
      metadata: (input.metadata ?? {}) as object,
    },
  });
}
