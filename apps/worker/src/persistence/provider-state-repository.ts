import type {
  CharacterProviderState,
  Prisma,
  PrismaClient,
  Provider,
  ProviderLifecycleState,
} from "@mplus/database";
import type {
  CharacterProviderStateDTO,
  ExcludedObservationDTO,
  ProviderName,
  SourceDisagreementDTO,
  WclVisibilityState,
} from "@mplus/contracts";

function providerNameToDb(provider: ProviderName): Provider {
  switch (provider) {
    case "blizzard":
      return "BLIZZARD";
    case "warcraftlogs":
      return "WARCRAFT_LOGS";
    case "raiderio":
      return "RAIDER_IO";
  }
}

export interface UpsertProviderStateInput {
  characterId: string;
  provider: ProviderName;
  state: ProviderLifecycleState;
  detail?: string | null;
  warnings?: string[];
  disagreements?: SourceDisagreementDTO[];
  excludedObservations?: ExcludedObservationDTO[];
  wclVisibility?: WclVisibilityState | null;
  lastAttemptAt: Date;
  lastSuccessAt?: Date | null;
  fetchedAt?: Date | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface ProviderStateRepository {
  upsert(input: UpsertProviderStateInput): Promise<CharacterProviderState>;
  listForCharacter(characterId: string): Promise<CharacterProviderStateDTO[]>;
}

function toDto(row: CharacterProviderState): CharacterProviderStateDTO {
  const provider: ProviderName =
    row.provider === "BLIZZARD"
      ? "blizzard"
      : row.provider === "WARCRAFT_LOGS"
        ? "warcraftlogs"
        : "raiderio";

  return {
    provider,
    state: row.state,
    detail: row.detail,
    lastAttemptAt: row.lastAttemptAt.toISOString(),
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    wclVisibility: (row.wclVisibility as WclVisibilityState | null) ?? null,
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
  };
}

export function createProviderStateRepository(prisma: PrismaClient): ProviderStateRepository {
  return {
    async upsert(input) {
      const provider = providerNameToDb(input.provider) as Provider;
      const state = input.state as ProviderLifecycleState;
      const data = {
        state,
        detail: input.detail ?? null,
        warnings: (input.warnings ?? []) as Prisma.InputJsonValue,
        disagreements: (input.disagreements ?? []) as unknown as Prisma.InputJsonValue,
        excludedObservations: (input.excludedObservations ?? []) as unknown as Prisma.InputJsonValue,
        wclVisibility: input.wclVisibility ?? null,
        lastAttemptAt: input.lastAttemptAt,
        lastSuccessAt: input.lastSuccessAt ?? null,
        fetchedAt: input.fetchedAt ?? null,
        expiresAt: input.expiresAt ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      };

      return prisma.characterProviderState.upsert({
        where: {
          characterId_provider: {
            characterId: input.characterId,
            provider,
          },
        },
        create: {
          characterId: input.characterId,
          provider,
          ...data,
        },
        update: data,
      });
    },

    async listForCharacter(characterId) {
      const rows = await prisma.characterProviderState.findMany({
        where: { characterId },
        orderBy: { provider: "asc" },
      });
      return rows.map(toDto);
    },
  };
}
