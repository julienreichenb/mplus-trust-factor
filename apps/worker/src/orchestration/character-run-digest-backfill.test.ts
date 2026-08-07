import { describe, expect, it, vi } from "vitest";
import { CharacterRunDigestCharacterLinkConflictError } from "@mplus/database";
import {
  backfillCharacterRunDigestLinks,
  digestMatchesCharacterIdentity,
} from "./character-run-digest-backfill.js";

describe("digestMatchesCharacterIdentity", () => {
  const character = {
    normalizedName: "matea",
    regionCode: "EU",
    realmSlug: "archimonde",
  };

  it("matches exact region + realm + normalized name", () => {
    expect(
      digestMatchesCharacterIdentity({
        digest: {
          characterName: "MateA",
          realmSlug: "Archimonde",
          regionCode: "eu",
        },
        character,
      }),
    ).toBe(true);
  });

  it("rejects different realm (no name-only link)", () => {
    expect(
      digestMatchesCharacterIdentity({
        digest: {
          characterName: "MateA",
          realmSlug: "kazzak",
          regionCode: "EU",
        },
        character,
      }),
    ).toBe(false);
  });

  it("rejects incomplete digest identity", () => {
    expect(
      digestMatchesCharacterIdentity({
        digest: {
          characterName: "MateA",
          realmSlug: null,
          regionCode: "EU",
        },
        character,
      }),
    ).toBe(false);
  });
});

describe("backfillCharacterRunDigestLinks", () => {
  function makeHarness(seed: {
    character: {
      id: string;
      normalizedName: string;
      regionCode: string;
      realmSlug: string;
    };
    digests: Array<{
      id: string;
      characterName: string;
      realmSlug: string | null;
      regionCode: string | null;
      characterId: string | null;
      participantActorId?: number;
      rawRunId?: string;
    }>;
  }) {
    const digests = [...seed.digests];
    const attachCalls: Array<{ digestId: string; characterId: string }> = [];

    const prisma = {
      character: {
        findUnique: vi.fn(async () => ({
          id: seed.character.id,
          normalizedName: seed.character.normalizedName,
          region: { code: seed.character.regionCode },
          realm: { slug: seed.character.realmSlug },
        })),
      },
      characterRunDigest: {
        count: vi.fn(async ({ where }: { where: { characterId: string } }) =>
          digests.filter((d) => d.characterId === where.characterId).length,
        ),
      },
    };

    const repo = {
      listUnlinkedByRegionRealm: vi.fn(async () =>
        digests
          .filter((d) => d.characterId == null)
          .filter(
            (d) =>
              (d.regionCode ?? "").toLowerCase() ===
                seed.character.regionCode.toLowerCase() &&
              (d.realmSlug ?? "").toLowerCase() ===
                seed.character.realmSlug.toLowerCase(),
          )
          .map((d) => ({
            id: d.id,
            characterName: d.characterName,
            realmSlug: d.realmSlug,
            regionCode: d.regionCode,
            participantActorId: d.participantActorId ?? 1,
            rawRunId: d.rawRunId ?? "raw-1",
          })),
      ),
      attachCharacter: vi.fn(async (input: { digestId: string; characterId: string }) => {
        attachCalls.push(input);
        const row = digests.find((d) => d.id === input.digestId);
        if (!row) throw new Error("missing");
        if (row.characterId != null && row.characterId !== input.characterId) {
          throw new CharacterRunDigestCharacterLinkConflictError({
            digestId: input.digestId,
            existingCharacterId: row.characterId,
            requestedCharacterId: input.characterId,
          });
        }
        row.characterId = input.characterId;
        return { ...row, characterId: input.characterId };
      }),
    };

    return { prisma, repo, digests, attachCalls };
  }

  it("links all matching unlinked digests for a newly resolved Character", async () => {
    const { prisma, repo, digests } = makeHarness({
      character: {
        id: "char-mate",
        normalizedName: "matea",
        regionCode: "EU",
        realmSlug: "archimonde",
      },
      digests: [
        {
          id: "d1",
          characterName: "MateA",
          realmSlug: "archimonde",
          regionCode: "EU",
          characterId: null,
          rawRunId: "run-1",
        },
        {
          id: "d2",
          characterName: "MateA",
          realmSlug: "archimonde",
          regionCode: "EU",
          characterId: null,
          rawRunId: "run-2",
        },
        {
          id: "d-other",
          characterName: "Other",
          realmSlug: "archimonde",
          regionCode: "EU",
          characterId: null,
        },
      ],
    });

    const first = await backfillCharacterRunDigestLinks({
      prisma: prisma as never,
      characterId: "char-mate",
      digests: repo as never,
    });
    expect(first.linked).toBe(2);
    expect(first.digestIdsLinked.sort()).toEqual(["d1", "d2"]);
    expect(digests.find((d) => d.id === "d-other")?.characterId).toBeNull();

    const second = await backfillCharacterRunDigestLinks({
      prisma: prisma as never,
      characterId: "char-mate",
      digests: repo as never,
    });
    expect(second.linked).toBe(0);
    expect(second.matched).toBe(0);
  });

  it("is a no-op when digests are already linked to the same Character", async () => {
    const { prisma, repo, attachCalls } = makeHarness({
      character: {
        id: "char-mate",
        normalizedName: "matea",
        regionCode: "EU",
        realmSlug: "archimonde",
      },
      digests: [
        {
          id: "d1",
          characterName: "MateA",
          realmSlug: "archimonde",
          regionCode: "EU",
          characterId: "char-mate",
        },
      ],
    });

    const result = await backfillCharacterRunDigestLinks({
      prisma: prisma as never,
      characterId: "char-mate",
      digests: repo as never,
    });
    expect(result.linked).toBe(0);
    expect(attachCalls).toHaveLength(0);
  });

  it("never reassigns digests linked to a different Character", async () => {
    const { prisma, repo, digests } = makeHarness({
      character: {
        id: "char-mate",
        normalizedName: "matea",
        regionCode: "EU",
        realmSlug: "archimonde",
      },
      digests: [
        {
          id: "d1",
          characterName: "MateA",
          realmSlug: "archimonde",
          regionCode: "EU",
          characterId: "char-other",
        },
      ],
    });

    // listUnlinked filters characterId null — already-linked foreign digests stay put.
    const result = await backfillCharacterRunDigestLinks({
      prisma: prisma as never,
      characterId: "char-mate",
      digests: repo as never,
    });
    expect(result.linked).toBe(0);
    expect(digests[0]!.characterId).toBe("char-other");
  });

  it("does not cross-link same name on a different realm", async () => {
    const { prisma, repo, digests } = makeHarness({
      character: {
        id: "char-mate",
        normalizedName: "matea",
        regionCode: "EU",
        realmSlug: "archimonde",
      },
      digests: [
        {
          id: "d-kazzak",
          characterName: "MateA",
          realmSlug: "kazzak",
          regionCode: "EU",
          characterId: null,
        },
      ],
    });

    const result = await backfillCharacterRunDigestLinks({
      prisma: prisma as never,
      characterId: "char-mate",
      digests: repo as never,
    });
    expect(result.linked).toBe(0);
    expect(digests[0]!.characterId).toBeNull();
  });

  it("fails closed when Character identity is incomplete", async () => {
    const prisma = {
      character: {
        findUnique: vi.fn(async () => ({
          id: "char-x",
          normalizedName: "matea",
          region: { code: "EU" },
          realm: { slug: "" },
        })),
      },
      characterRunDigest: { count: vi.fn(async () => 0) },
    };
    const result = await backfillCharacterRunDigestLinks({
      prisma: prisma as never,
      characterId: "char-x",
      digests: {
        listUnlinkedByRegionRealm: vi.fn(async () => {
          throw new Error("must not query when identity incomplete");
        }),
        attachCharacter: vi.fn(),
      } as never,
    });
    expect(result.skippedIncompleteIdentity).toBe(1);
    expect(result.linked).toBe(0);
  });

  it("fails closed when same-name candidates include incomplete identity", async () => {
    const prisma = {
      character: {
        findUnique: vi.fn(async () => ({
          id: "char-mate",
          normalizedName: "matea",
          region: { code: "EU" },
          realm: { slug: "archimonde" },
        })),
      },
      characterRunDigest: { count: vi.fn(async () => 0) },
    };
    const attach = vi.fn();
    const result = await backfillCharacterRunDigestLinks({
      prisma: prisma as never,
      characterId: "char-mate",
      digests: {
        listUnlinkedByRegionRealm: vi.fn(async () => [
          {
            id: "d-ok",
            characterName: "MateA",
            realmSlug: "archimonde",
            regionCode: "EU",
            participantActorId: 1,
            rawRunId: "r1",
          },
          {
            id: "d-ambiguous",
            characterName: "MateA",
            realmSlug: null,
            regionCode: "EU",
            participantActorId: 2,
            rawRunId: "r2",
          },
        ]),
        attachCharacter: attach,
      } as never,
    });
    expect(result.linked).toBe(0);
    expect(result.skippedIncompleteIdentity).toBe(1);
    expect(attach).not.toHaveBeenCalled();
  });

  it("counts conflict when attach refuses a foreign link", async () => {
    const prisma = {
      character: {
        findUnique: vi.fn(async () => ({
          id: "char-mate",
          normalizedName: "matea",
          region: { code: "EU" },
          realm: { slug: "archimonde" },
        })),
      },
      characterRunDigest: { count: vi.fn(async () => 0) },
    };
    const result = await backfillCharacterRunDigestLinks({
      prisma: prisma as never,
      characterId: "char-mate",
      digests: {
        listUnlinkedByRegionRealm: vi.fn(async () => [
          {
            id: "d1",
            characterName: "MateA",
            realmSlug: "archimonde",
            regionCode: "EU",
            participantActorId: 1,
            rawRunId: "r1",
          },
        ]),
        attachCharacter: vi.fn(async () => {
          throw new CharacterRunDigestCharacterLinkConflictError({
            digestId: "d1",
            existingCharacterId: "char-other",
            requestedCharacterId: "char-mate",
          });
        }),
      } as never,
    });
    expect(result.linked).toBe(0);
    expect(result.skippedConflict).toBe(1);
  });

  it("after backfill, linked digests are discoverable by characterId for reuse", async () => {
    const { prisma, repo, digests } = makeHarness({
      character: {
        id: "char-mate",
        normalizedName: "matea",
        regionCode: "EU",
        realmSlug: "archimonde",
      },
      digests: [
        {
          id: "d1",
          characterName: "MateA",
          realmSlug: "archimonde",
          regionCode: "EU",
          characterId: null,
          rawRunId: "run-1",
        },
        {
          id: "d2",
          characterName: "MateA",
          realmSlug: "archimonde",
          regionCode: "EU",
          characterId: null,
          rawRunId: "run-2",
        },
      ],
    });

    await backfillCharacterRunDigestLinks({
      prisma: prisma as never,
      characterId: "char-mate",
      digests: repo as never,
    });

    const reusable = digests.filter((d) => d.characterId === "char-mate");
    expect(reusable).toHaveLength(2);
    expect(reusable.map((d) => d.rawRunId).sort()).toEqual(["run-1", "run-2"]);
  });
});
