import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clearSeasonAuthorityCacheForTests,
  peekVerifiedSeasonAuthority,
  requireVerifiedSeasonAuthority,
  SeasonAuthorityUnavailableError,
  synchronizeSeasonAuthority,
  SEASON_AUTHORITY_VALIDITY_SECONDS,
} from "./season-authority.js";

describe("season authority barrier", () => {
  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
  });

  function buildPrisma(seed?: {
    id?: string;
    slug?: string;
    blizzardSeasonId?: number;
    metadata?: Record<string, unknown>;
    isCurrent?: boolean;
  }) {
    const seasons = new Map<string, Record<string, unknown>>();
    if (seed) {
      seasons.set(seed.slug ?? "blizzard-season-17", {
        id: seed.id ?? "s17",
        regionId: "region-eu",
        slug: seed.slug ?? "blizzard-season-17",
        blizzardSeasonId: seed.blizzardSeasonId ?? 17,
        isCurrent: seed.isCurrent ?? true,
        name: "Blizzard Season 17",
        metadata: seed.metadata ?? {},
      });
    }

    return {
      season: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.slug) {
            return seasons.get(String(where.slug)) ?? null;
          }
          if (where.isCurrent) {
            return [...seasons.values()].find((s) => s.isCurrent) ?? null;
          }
          return null;
        }),
        updateMany: vi.fn(async ({ where }: { where: { NOT: { slug: string } } }) => {
          for (const [slug, row] of seasons) {
            if (slug !== where.NOT.slug) {
              seasons.set(slug, { ...row, isCurrent: false });
            }
          }
          return { count: 1 };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = [...seasons.values()].find((s) => s.id === where.id);
          if (!existing) throw new Error("missing");
          const next = { ...existing, ...data, id: where.id };
          seasons.set(String(next.slug), next);
          return next;
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `s-${data.slug}`, ...data };
          seasons.set(String(data.slug), row);
          return row;
        }),
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
          const row = [...seasons.values()].find((s) => s.id === where.id);
          if (!row) throw new Error("missing");
          return row;
        }),
      },
      region: {
        findUnique: vi.fn(async () => ({ id: "region-eu", code: "EU" })),
        findMany: vi.fn(async () => [{ id: "region-eu", code: "EU" }]),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "region-eu",
          ...data,
        })),
      },
      _seasons: seasons,
    };
  }

  it("synchronizes DB from Blizzard 17 when DB still points at season 3", async () => {
    const prisma = buildPrisma({
      id: "s3",
      slug: "blizzard-season-3",
      blizzardSeasonId: 3,
      metadata: { source: "blizzard" },
    });
    const resolveAuthoritativeCurrentSeasonId = vi.fn(async () => ({
      data: {
        seasonId: 17,
        slug: "blizzard-season-17",
        source: "season_index.current_season" as const,
      },
    }));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const authority = await synchronizeSeasonAuthority(
      {
        prisma: prisma as never,
        blizzard: { resolveAuthoritativeCurrentSeasonId } as never,
        logger: logger as never,
      },
      "EU",
      "region-eu",
    );

    expect(authority.blizzardSeasonId).toBe(17);
    expect(authority.slug).toBe("blizzard-season-17");
    expect(authority.authoritySource).toBe("season_index.current_season");
    expect(resolveAuthoritativeCurrentSeasonId).toHaveBeenCalledTimes(1);
    expect(prisma._seasons.get("blizzard-season-17")?.isCurrent).toBe(true);
    expect(prisma._seasons.get("blizzard-season-3")?.isCurrent).toBe(false);
  });

  it("rejects non-current_season sources", async () => {
    const prisma = buildPrisma();
    const resolveAuthoritativeCurrentSeasonId = vi.fn(async () => ({
      data: {
        seasonId: 17,
        slug: "blizzard-season-17",
        source: "season_index.last" as const,
      },
    }));

    await expect(
      synchronizeSeasonAuthority(
        {
          prisma: prisma as never,
          blizzard: { resolveAuthoritativeCurrentSeasonId } as never,
          logger: { info: vi.fn(), warn: vi.fn() } as never,
        },
        "EU",
        "region-eu",
      ),
    ).rejects.toBeInstanceOf(SeasonAuthorityUnavailableError);
  });

  it("prefers a newer DB authority over stale process memory", async () => {
    const oldVerifiedAt = new Date(Date.now() - 60_000).toISOString();
    const prisma = buildPrisma({
      id: "s13",
      slug: "blizzard-season-13",
      blizzardSeasonId: 13,
      metadata: {
        blizzardSeasonId: 13,
        authoritySource: "season_index.current_season",
        authorityVerifiedAt: oldVerifiedAt,
      },
    });

    const first = await peekVerifiedSeasonAuthority(
      { prisma: prisma as never },
      "EU",
      "region-eu",
    );
    expect(first?.blizzardSeasonId).toBe(13);

    // Simulate another process repairing EU to season 17 in the shared DB.
    prisma._seasons.clear();
    prisma._seasons.set("blizzard-season-17", {
      id: "s17",
      regionId: "region-eu",
      slug: "blizzard-season-17",
      blizzardSeasonId: 17,
      isCurrent: true,
      name: "Blizzard Season 17",
      metadata: {
        blizzardSeasonId: 17,
        authoritySource: "season_index.current_season",
        authorityVerifiedAt: new Date().toISOString(),
      },
    });

    const second = await peekVerifiedSeasonAuthority(
      { prisma: prisma as never },
      "EU",
      "region-eu",
    );
    expect(second?.blizzardSeasonId).toBe(17);
    expect(second?.slug).toBe("blizzard-season-17");
    expect(second?.resolution).toBe("database");
  });

  it("reuses still-valid cached authority without a provider call", async () => {
    const verifiedAt = new Date().toISOString();
    const prisma = buildPrisma({
      metadata: {
        blizzardSeasonId: 17,
        source: "blizzard",
        authoritySource: "season_index.current_season",
        authorityVerifiedAt: verifiedAt,
      },
    });
    const resolveAuthoritativeCurrentSeasonId = vi.fn();

    const peeked = await peekVerifiedSeasonAuthority(
      { prisma: prisma as never },
      "EU",
      "region-eu",
    );
    expect(peeked?.blizzardSeasonId).toBe(17);

    const synced = await synchronizeSeasonAuthority(
      {
        prisma: prisma as never,
        blizzard: { resolveAuthoritativeCurrentSeasonId } as never,
        logger: { info: vi.fn(), warn: vi.fn() } as never,
      },
      "EU",
      "region-eu",
    );
    expect(synced.resolution).not.toBe("provider");
    expect(resolveAuthoritativeCurrentSeasonId).not.toHaveBeenCalled();
  });

  it("fails closed when allowProviderSync is false and authority is unverified", async () => {
    const prisma = buildPrisma({
      slug: "placeholder-current",
      blizzardSeasonId: undefined,
      metadata: {},
    });

    await expect(
      requireVerifiedSeasonAuthority(
        {
          prisma: prisma as never,
          blizzard: { resolveAuthoritativeCurrentSeasonId: vi.fn() } as never,
          logger: { info: vi.fn(), warn: vi.fn() } as never,
        },
        "EU",
        "region-eu",
        { allowProviderSync: false },
      ),
    ).rejects.toBeInstanceOf(SeasonAuthorityUnavailableError);
  });

  it("deduplicates concurrent synchronization to one provider request", async () => {
    clearSeasonAuthorityCacheForTests();
    const prisma = buildPrisma();
    let calls = 0;
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const resolveAuthoritativeCurrentSeasonId = vi.fn(async () => {
      calls += 1;
      await gate;
      return {
        data: {
          seasonId: 17,
          slug: "blizzard-season-17",
          source: "season_index.current_season" as const,
        },
      };
    });

    const deps = {
      prisma: prisma as never,
      blizzard: { resolveAuthoritativeCurrentSeasonId } as never,
      logger: { info: vi.fn(), warn: vi.fn() } as never,
    };

    const p1 = synchronizeSeasonAuthority(deps, "EU", "region-eu");
    const p2 = synchronizeSeasonAuthority(deps, "EU", "region-eu");
    release(undefined);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a.blizzardSeasonId).toBe(17);
    expect(b.blizzardSeasonId).toBe(17);
    expect(calls).toBe(1);
    expect(resolveAuthoritativeCurrentSeasonId).toHaveBeenCalledTimes(1);
  });

  it("transitions 17 → 18 once without oscillation", async () => {
    const prisma = buildPrisma({
      metadata: {
        blizzardSeasonId: 17,
        authoritySource: "season_index.current_season",
        authorityVerifiedAt: new Date(0).toISOString(),
      },
    });
    // Force expiry by using tiny validity.
    const resolveAuthoritativeCurrentSeasonId = vi.fn(async () => ({
      data: {
        seasonId: 18,
        slug: "blizzard-season-18",
        source: "season_index.current_season" as const,
      },
    }));

    const authority = await synchronizeSeasonAuthority(
      {
        prisma: prisma as never,
        blizzard: { resolveAuthoritativeCurrentSeasonId } as never,
        logger: { info: vi.fn(), warn: vi.fn() } as never,
        validitySeconds: 1,
      },
      "EU",
      "region-eu",
      { forceRefresh: true },
    );

    expect(authority.blizzardSeasonId).toBe(18);
    expect(prisma._seasons.get("blizzard-season-18")?.isCurrent).toBe(true);
    expect(prisma._seasons.get("blizzard-season-17")?.isCurrent).toBe(false);

    // Second sync within validity must not oscillate back.
    clearSeasonAuthorityCacheForTests();
    // Stamp fresh verification on 18
    const row18 = prisma._seasons.get("blizzard-season-18")!;
    row18.metadata = {
      ...(row18.metadata as object),
      authoritySource: "season_index.current_season",
      authorityVerifiedAt: new Date().toISOString(),
    };
    resolveAuthoritativeCurrentSeasonId.mockClear();

    const again = await synchronizeSeasonAuthority(
      {
        prisma: prisma as never,
        blizzard: { resolveAuthoritativeCurrentSeasonId } as never,
        logger: { info: vi.fn(), warn: vi.fn() } as never,
        validitySeconds: SEASON_AUTHORITY_VALIDITY_SECONDS,
      },
      "EU",
      "region-eu",
    );
    expect(again.blizzardSeasonId).toBe(18);
    expect(resolveAuthoritativeCurrentSeasonId).not.toHaveBeenCalled();
  });
});
