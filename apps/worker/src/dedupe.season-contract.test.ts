import { describe, expect, it, vi } from "vitest";
import { refreshCharacterDedupeKey } from "./dedupe.js";
import type { RefreshCharacterJob } from "@mplus/contracts";

describe("refresh enqueue dedupe vs terminal obsolete contracts", () => {
  const base: RefreshCharacterJob = {
    region: "EU",
    realmSlug: "archimonde",
    name: "Wallidrixe",
    priority: "normal",
    forceRefresh: false,
    requestedAt: "2026-07-30T12:00:00.000Z",
  };

  it("terminal job under old contract is not reused for a new contract", () => {
    const oldKey = refreshCharacterDedupeKey({
      ...base,
      refreshContractHash: "old-season-3-hash",
      authoritativeSeasonId: 3,
    });
    const newKey = refreshCharacterDedupeKey({
      ...base,
      refreshContractHash: "new-season-17-hash",
      authoritativeSeasonId: 17,
    });
    expect(oldKey).not.toBe(newKey);
  });

  it("active job under the exact same contract reuses the same dedupe key", () => {
    const a = refreshCharacterDedupeKey({
      ...base,
      refreshContractHash: "same-hash",
      authoritativeSeasonId: 17,
    });
    const b = refreshCharacterDedupeKey({
      ...base,
      refreshContractHash: "same-hash",
      authoritativeSeasonId: 17,
    });
    expect(a).toBe(b);
  });
});

// Silence unused import lint in some configs
void vi;
