import { describe, expect, it, vi } from "vitest";

vi.mock("./effective-season-peek.js", () => ({
  peekEffectiveScoringSeasonRowGlobal: vi.fn(async () => ({
    blizzardSeasonId: 14,
    selectionMode: "AUTO" as const,
  })),
}));

vi.mock("./effective-scoring-season.js", () => ({
  resolveScoringCatalogDiscoverer: vi.fn(),
}));

vi.mock("./synchronize-scoring-season-data.js", () => ({
  synchronizeScoringSeasonData: vi.fn(async () => ({ blizzardSeasonId: 14, regions: [] })),
}));

vi.mock("../key-distribution-refresh.js", () => ({
  withSharedAddonIngestSession: vi.fn(async (_input, fn) =>
    fn({
      refreshRegion: vi.fn(),
      downloadCount: () => 1,
    }),
  ),
}));

describe("runScheduledScoringSeasonDataSync", () => {
  it("joins an in-flight sync instead of starting a duplicate", async () => {
    const { runScheduledScoringSeasonDataSync } = await import("./scoring-season-data-sync.js");
    const { synchronizeScoringSeasonData } = await import("./synchronize-scoring-season-data.js");
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    };

    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(synchronizeScoringSeasonData).mockImplementationOnce(async () => {
      await gate;
      return { blizzardSeasonId: 14, regions: [] };
    });
    vi.mocked(synchronizeScoringSeasonData).mockResolvedValueOnce({ blizzardSeasonId: 14, regions: [] });

    const input = {
      prisma: {} as never,
      logger: logger as never,
    };

    const first = runScheduledScoringSeasonDataSync(input);
    const second = runScheduledScoringSeasonDataSync(input);
    releaseFirst?.();
    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual(b);
    expect(vi.mocked(synchronizeScoringSeasonData)).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "season_data_sync_joined", blizzardSeasonId: 14 }),
      "joining in-flight scoring season data sync",
    );
  });
});
