import { describe, expect, it, vi } from "vitest";

/**
 * Documents the public-search filter contract used by GET /api/v1/realms.
 * Persistence defaults: active only, tournament excluded.
 */
describe("realm public search contract", () => {
  it("defaults exclude inactive and tournament rows", async () => {
    const findMany = vi.fn(async () => []);
    const prisma = { realm: { findMany } };
    const { createRealmRepository } = await import("./realm-repository.js");
    const repo = createRealmRepository(prisma as never);
    await repo.search({ query: "INST", region: "EU", limit: 25 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          isTournament: false,
        }),
      }),
    );
  });

  it("exact findBySlug cannot resolve inactive internals", async () => {
    const findFirst = vi.fn(async () => null);
    const prisma = { realm: { findFirst } };
    const { createRealmRepository } = await import("./realm-repository.js");
    const repo = createRealmRepository(prisma as never);
    await repo.findBySlug("EU", "eu1a1inst");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: "eu1a1inst",
          isActive: true,
          isTournament: false,
        }),
      }),
    );
  });
});
