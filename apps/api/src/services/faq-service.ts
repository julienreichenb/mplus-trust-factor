import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@mplus/database";
import type {
  AdminFaqEntryDTO,
  FaqEmbedType,
  PublicFaqEntryDTO,
} from "@mplus/contracts";
import {
  createFaqEntryRequestSchema,
  firstZodIssueMessage,
  moveFaqEntryRequestSchema,
  updateFaqEntryRequestSchema,
} from "@mplus/contracts";
import type { ZodType } from "zod";
import { HttpError } from "../errors.js";
import { writeAuditEvent } from "../iam/audit.js";

const FAQ_ORDER_BY = [
  { position: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
] as const satisfies Prisma.FaqEntryOrderByWithRelationInput[];

export interface FaqAuditContext {
  userId?: string | null;
  actorType: "user" | "admin_key";
  ip?: string | null;
  userAgent?: string | null;
  sessionSecret: string;
}

export class FaqService {
  constructor(private readonly prisma: PrismaClient) {}

  async listPublished(): Promise<{ entries: PublicFaqEntryDTO[] }> {
    const rows = await this.prisma.faqEntry.findMany({
      where: { isPublished: true },
      orderBy: [...FAQ_ORDER_BY],
    });
    return { entries: rows.map(toPublicDto) };
  }

  async listAll(): Promise<{ entries: AdminFaqEntryDTO[] }> {
    const rows = await this.prisma.faqEntry.findMany({
      orderBy: [...FAQ_ORDER_BY],
    });
    return { entries: rows.map(toAdminDto) };
  }

  async create(body: unknown, audit: FaqAuditContext): Promise<AdminFaqEntryDTO> {
    const input = parseBody(createFaqEntryRequestSchema, body);
    const position = input.position ?? (await this.nextPosition());
    const created = await this.prisma.faqEntry.create({
      data: {
        id: randomUUID(),
        title: input.title,
        description: input.description,
        position,
        isPublished: input.isPublished ?? false,
        embedType: input.embedType ?? null,
      },
    });
    await this.audit("admin.faq.create", created.id, audit, { position: created.position });
    return toAdminDto(created);
  }

  async update(id: string, body: unknown, audit: FaqAuditContext): Promise<AdminFaqEntryDTO> {
    await this.requireEntry(id);
    const input = parseBody(updateFaqEntryRequestSchema, body);
    const updated = await this.prisma.faqEntry.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
        ...(input.embedType !== undefined ? { embedType: input.embedType } : {}),
      },
    });
    await this.audit("admin.faq.update", id, audit, {
      fields: Object.keys(input),
    });
    return toAdminDto(updated);
  }

  async move(id: string, body: unknown, audit: FaqAuditContext): Promise<AdminFaqEntryDTO> {
    const input = parseBody(moveFaqEntryRequestSchema, body);
    const entries = await this.prisma.faqEntry.findMany({ orderBy: [...FAQ_ORDER_BY] });
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw HttpError.notFound("FAQ_NOT_FOUND", "FAQ entry was not found");
    }
    const swapWith = input.direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= entries.length) {
      return toAdminDto(entries[index]!);
    }
    const reordered = [...entries];
    const current = reordered[index]!;
    const neighbor = reordered[swapWith]!;
    reordered[index] = neighbor;
    reordered[swapWith] = current;
    await this.prisma.$transaction(
      reordered.map((entry, position) =>
        this.prisma.faqEntry.update({
          where: { id: entry.id },
          data: { position: position + 1 },
        }),
      ),
    );
    await this.audit("admin.faq.move", id, audit, { direction: input.direction });
    const moved = await this.requireEntry(id);
    return toAdminDto(moved);
  }

  async delete(id: string, audit: FaqAuditContext): Promise<{ id: string }> {
    await this.requireEntry(id);
    await this.prisma.faqEntry.delete({ where: { id } });
    await this.audit("admin.faq.delete", id, audit, {});
    return { id };
  }

  private async nextPosition(): Promise<number> {
    const max = await this.prisma.faqEntry.aggregate({ _max: { position: true } });
    return (max._max.position ?? 0) + 1;
  }

  private async requireEntry(id: string) {
    const entry = await this.prisma.faqEntry.findUnique({ where: { id } });
    if (!entry) {
      throw HttpError.notFound("FAQ_NOT_FOUND", "FAQ entry was not found");
    }
    return entry;
  }

  private async audit(
    action: string,
    resourceId: string,
    ctx: FaqAuditContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditEvent(this.prisma, {
      userId: ctx.userId,
      actorType: ctx.actorType,
      action,
      resourceType: "faq_entry",
      resourceId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      sessionSecret: ctx.sessionSecret,
      metadata,
    });
  }
}

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw HttpError.badRequest("VALIDATION_ERROR", firstZodIssueMessage(parsed.error), parsed.error.flatten());
  }
  return parsed.data;
}

function toPublicDto(row: {
  id: string;
  title: string;
  description: string;
  position: number;
  embedType: FaqEmbedType | null;
}): PublicFaqEntryDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    position: row.position,
    embedType: row.embedType,
  };
}

function toAdminDto(row: {
  id: string;
  title: string;
  description: string;
  position: number;
  embedType: FaqEmbedType | null;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}): AdminFaqEntryDTO {
  return {
    ...toPublicDto(row),
    isPublished: row.isPublished,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
