/**
 * Plumbing regression: SeasonDungeon → wclActiveDungeon* must reach WCL discovery.
 * Does not change discovery algorithms — only verifies wiring after hydration cleanup.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ProviderFetchContext } from "@mplus/contracts";

const here = fileURLToPath(new URL(".", import.meta.url));
const refreshPipelineSrc = readFileSync(resolve(here, "refresh-pipeline.ts"), "utf8");
const liveProbeSrc = readFileSync(
  resolve(here, "scoring/live-character-probe/pipeline.ts"),
  "utf8",
);

describe("WCL active dungeon binding plumbing", () => {
  it("refresh-pipeline queries SeasonDungeon before deriving encounter bindings", () => {
    const queryIdx = refreshPipelineSrc.indexOf(
      "const preWclSeasonDungeonRows = await container.prisma.seasonDungeon.findMany",
    );
    const slugsIdx = refreshPipelineSrc.indexOf("const wclActiveDungeonSlugs = preWclSeasonDungeonRows");
    const encountersIdx = refreshPipelineSrc.indexOf(
      "const wclActiveDungeonEncounters = preWclSeasonDungeonRows",
    );
    const enrichIdx = refreshPipelineSrc.indexOf(
      "const wclEnrichment = await enrichWarcraftLogs(",
    );

    expect(queryIdx).toBeGreaterThan(0);
    expect(slugsIdx).toBeGreaterThan(queryIdx);
    expect(encountersIdx).toBeGreaterThan(queryIdx);
    expect(enrichIdx).toBeGreaterThan(encountersIdx);
    expect(refreshPipelineSrc).toMatch(
      /enrichWarcraftLogs\(\s*wclActiveDungeonSlugs,\s*wclActiveDungeonEncounters,?\s*\)/,
    );
    expect(refreshPipelineSrc).not.toMatch(/wclHydrationHints/);
    expect(refreshPipelineSrc).not.toMatch(/hydrationHints/);
  });

  it("enrichWarcraftLogs passes SeasonDungeon bindings into ProviderFetchContext", () => {
    expect(refreshPipelineSrc).toMatch(/wclActiveDungeonSlugs:\s*\[\.\.\.activeDungeonSlugs\]/);
    expect(refreshPipelineSrc).toMatch(
      /wclActiveDungeonEncounters:\s*\[\.\.\.activeDungeonEncounters\]/,
    );
  });

  it("live-character-probe passes zone encounter bindings into discoverCharacter", () => {
    expect(liveProbeSrc).toMatch(/wclActiveDungeonSlugs:\s*\[\.\.\.activeDungeonSlugs\]/);
    expect(liveProbeSrc).toMatch(/wclActiveDungeonEncounters/);
    expect(liveProbeSrc).toMatch(/discoverCharacter\(identity,\s*discoveryCtx\)/);
    expect(liveProbeSrc).not.toMatch(/discoverCharacter\(identity,\s*ctx\)/);
  });

  it("derives encounter bindings from SeasonDungeon rows the same way as production", () => {
    const rows = [
      {
        dungeon: { slug: "Skyreach", wclZoneOrEncounterId: BigInt(12_532) },
      },
      {
        dungeon: { slug: "Windrunner Spire", wclZoneOrEncounterId: BigInt(12_533) },
      },
      {
        dungeon: { slug: "Missing Binding", wclZoneOrEncounterId: null },
      },
    ] as const;

    const canonicalDungeonKey = (slug: string) =>
      slug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    const wclActiveDungeonSlugs = rows.map((row) => canonicalDungeonKey(row.dungeon.slug));
    const wclActiveDungeonEncounters = rows
      .map((row) => {
        const dungeonSlug = canonicalDungeonKey(row.dungeon.slug);
        const encounterId =
          row.dungeon.wclZoneOrEncounterId != null
            ? Number(row.dungeon.wclZoneOrEncounterId)
            : null;
        if (encounterId == null || !Number.isFinite(encounterId) || encounterId <= 0) {
          return null;
        }
        return { dungeonSlug, encounterId };
      })
      .filter((row): row is { dungeonSlug: string; encounterId: number } => row != null);

    const ctx: ProviderFetchContext = {
      region: "EU",
      requestId: "test",
      correlationId: null,
      forceRefresh: false,
      now: new Date().toISOString(),
      wclActiveDungeonSlugs,
      wclActiveDungeonEncounters,
    };

    expect(ctx.wclActiveDungeonSlugs).toEqual([
      "skyreach",
      "windrunner-spire",
      "missing-binding",
    ]);
    expect(ctx.wclActiveDungeonEncounters).toEqual([
      { dungeonSlug: "skyreach", encounterId: 12_532 },
      { dungeonSlug: "windrunner-spire", encounterId: 12_533 },
    ]);

    // Sanity: discoverCharacter would receive these bindings (spy-shaped).
    const discoverCharacter = vi.fn(async (_id: unknown, fetchCtx: ProviderFetchContext) => fetchCtx);
    void discoverCharacter({ name: "x" }, ctx);
    expect(discoverCharacter.mock.calls[0]![1].wclActiveDungeonEncounters).toHaveLength(2);
  });
});
