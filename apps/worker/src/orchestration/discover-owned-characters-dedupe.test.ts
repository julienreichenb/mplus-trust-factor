import { describe, expect, it } from "vitest";
import { discoverOwnedCharactersDedupeKey } from "../dedupe.js";

describe("discoverOwnedCharactersDedupeKey", () => {
  it("dedupes by account, season, and ownership sync revision", () => {
    const base = {
      battleNetAccountId: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      ownershipSyncAt: "2026-07-30T00:00:00.000Z",
      seasonKey: "season-tww-3",
      requestedAt: "2026-07-30T00:01:00.000Z",
    };
    const a = discoverOwnedCharactersDedupeKey(base);
    const b = discoverOwnedCharactersDedupeKey({ ...base, requestedAt: "2026-07-30T00:02:00.000Z" });
    const c = discoverOwnedCharactersDedupeKey({
      ...base,
      ownershipSyncAt: "2026-07-30T01:00:00.000Z",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
