/**
 * Product refresh entrypoints must converge on runAuthoritativeScoring → scoreCharacter.
 * They must not invoke legacy pre-selection analyze-run acquisition.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../../../");

function readSrc(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

describe("product refresh routing (static convergence)", () => {
  it("Character page refresh POSTs once then polls GET status", () => {
    const page = readSrc("apps/web/src/pages/CharacterPage.vue");
    const polling = readSrc("apps/web/src/composables/useRefreshPolling.ts");
    expect(page).toMatch(/api\.refreshCharacter\(/);
    expect(page).toMatch(/startPolling\(/);
    expect(polling).toMatch(/getRefreshStatus/);
    expect(polling).not.toMatch(/refreshCharacter\(/);
    expect(polling).toMatch(/never enqueues refresh work/);
  });

  it("Account ownership refresh and Admin refresh-jobs rerun enqueue refresh-character", () => {
    const account = readSrc("apps/web/src/pages/AccountPage.vue");
    const admin = readSrc("apps/web/src/pages/AdminUsersPage.vue");
    const adminService = readSrc("apps/api/src/services/admin-refresh-jobs-service.ts");
    const ownership = readSrc("apps/api/src/iam/routes-auth.ts");

    expect(account).toMatch(/refresh-ownership/);
    expect(ownership).toMatch(/refresh-ownership/);
    expect(admin).toMatch(/admin\/refresh-jobs/);
    expect(adminService).toMatch(/enqueueRefreshCharacter/);
  });

  it("API character refresh and admin recalculate share producer enqueue paths", () => {
    const characters = readSrc("apps/api/src/routes/characters.ts");
    const characterService = readSrc("apps/api/src/services/character-service.ts");
    const admin = readSrc("apps/api/src/routes/admin.ts");
    const adminService = readSrc("apps/api/src/services/admin-service.ts");
    const processors = readSrc("apps/worker/src/processors.ts");

    expect(characters).toMatch(/\/refresh/);
    expect(characterService).toMatch(/enqueueRefreshCharacter/);
    expect(admin).toMatch(/recalculate/);
    expect(adminService).toMatch(/enqueueRecalculateScore|recalculateCharacter/);
    expect(processors).toMatch(/runRefreshPipeline/);
    expect(processors).toMatch(/runRecalculateScore/);
  });

  it("refresh pipeline always defers detailed WCL and calls runAuthoritativeScoring", () => {
    const pipeline = readSrc("apps/worker/src/orchestration/refresh-pipeline.ts");
    const bridge = readSrc("apps/worker/src/orchestration/scoring/refresh-bridge.ts");
    const recalculate = readSrc("apps/worker/src/orchestration/recalculate-score.ts");

    expect(pipeline).toMatch(/const deferDetailedWclAcquisitionToScoring = true/);
    expect(pipeline).toMatch(/runAuthoritativeScoring/);
    expect(pipeline).not.toMatch(
      /deferDetailedWclAcquisitionToScoring = container\.env\.SCORING_ENABLED/,
    );
    expect(bridge).toMatch(/scoreCharacter\(/);
    expect(bridge).not.toMatch(/if \(!input\.container\.env\.SCORING_ENABLED\)/);
    expect(recalculate).toMatch(/runAuthoritativeScoring/);
  });
});

describe("refresh dedupe key identity", () => {
  it("refreshCharacterDedupeKey is stable for identical character refresh payloads", async () => {
    const { refreshCharacterDedupeKey } = await import("../../dedupe.js");
    const base = {
      region: "EU" as const,
      realmSlug: "tarren-mill",
      name: "Wallidrixe",
      priority: "normal" as const,
      forceRefresh: false,
      requestedAt: "2026-08-07T12:00:00.000Z",
      refreshContractHash: "hash-a",
    };
    expect(refreshCharacterDedupeKey(base)).toBe(refreshCharacterDedupeKey({ ...base }));
    expect(refreshCharacterDedupeKey(base)).not.toBe(
      refreshCharacterDedupeKey({ ...base, name: "Otherchar" }),
    );
  });
});
