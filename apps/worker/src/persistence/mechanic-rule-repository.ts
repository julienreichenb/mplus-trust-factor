import type { MechanicRule, MechanicRuleType, PrismaClient } from "@mplus/database";

export interface MechanicRuleInput {
  seasonId: string;
  dungeonId: string;
  npcId?: number | null;
  spellId: number;
  ruleType: MechanicRuleType;
  severity: number;
  applicableRoles: Array<"DPS" | "TANK" | "HEALER">;
  responseSpellIds?: number[];
  notes?: string | null;
  source: string;
  version: string;
  active?: boolean;
}

export interface MechanicRuleRepository {
  list(filter?: { seasonId?: string; dungeonId?: string; active?: boolean }): Promise<MechanicRule[]>;
  findById(id: string): Promise<MechanicRule | null>;
  create(input: MechanicRuleInput): Promise<MechanicRule>;
  update(id: string, patch: Partial<MechanicRuleInput>): Promise<MechanicRule>;
  deactivate(id: string): Promise<MechanicRule>;
}

export function createMechanicRuleRepository(prisma: PrismaClient): MechanicRuleRepository {
  return {
    async list(filter) {
      return prisma.mechanicRule.findMany({
        where: {
          ...(filter?.seasonId ? { seasonId: filter.seasonId } : {}),
          ...(filter?.dungeonId ? { dungeonId: filter.dungeonId } : {}),
          ...(filter?.active !== undefined ? { active: filter.active } : {}),
        },
        orderBy: { spellId: "asc" },
      });
    },

    async findById(id) {
      return prisma.mechanicRule.findUnique({ where: { id } });
    },

    async create(input) {
      return prisma.mechanicRule.create({
        data: {
          seasonId: input.seasonId,
          dungeonId: input.dungeonId,
          npcId: input.npcId ? BigInt(input.npcId) : null,
          spellId: BigInt(input.spellId),
          ruleType: input.ruleType,
          severity: input.severity,
          applicableRoles: input.applicableRoles as object,
          responseSpellIds: (input.responseSpellIds ?? []) as object,
          notes: input.notes ?? null,
          source: input.source,
          version: input.version,
          active: input.active ?? true,
        },
      });
    },

    async update(id, patch) {
      return prisma.mechanicRule.update({
        where: { id },
        data: {
          ...(patch.npcId !== undefined ? { npcId: patch.npcId ? BigInt(patch.npcId) : null } : {}),
          ...(patch.spellId !== undefined ? { spellId: BigInt(patch.spellId) } : {}),
          ...(patch.ruleType !== undefined ? { ruleType: patch.ruleType } : {}),
          ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
          ...(patch.applicableRoles !== undefined ? { applicableRoles: patch.applicableRoles as object } : {}),
          ...(patch.responseSpellIds !== undefined
            ? { responseSpellIds: patch.responseSpellIds as object }
            : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.source !== undefined ? { source: patch.source } : {}),
          ...(patch.version !== undefined ? { version: patch.version } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
        },
      });
    },

    async deactivate(id) {
      return prisma.mechanicRule.update({ where: { id }, data: { active: false } });
    },
  };
}
