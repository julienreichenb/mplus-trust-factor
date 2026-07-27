import { describe, expect, it, beforeEach } from "vitest";
import { createMockApiClient, validateModelConfig } from "./client";
import { DEFAULT_MODEL_CONFIG, resetMockState } from "./fixtures";

describe("mock API client", () => {
  beforeEach(() => {
    resetMockState();
  });

  it("returns a rich profile for Aleria", async () => {
    const api = createMockApiClient();
    const profile = await api.getCharacterProfile({
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Aleria",
    });
    expect(profile.score?.overallScore).toBe(88);
    expect(profile.score?.grade).toBe("A");
    expect(profile.raiderIoUsed).toBe(true);
    expect(profile.lastAnalyzedRun?.kind).toBe("BOTH");
  });

  it("throws not found for unknown characters", async () => {
    const api = createMockApiClient();
    await expect(
      api.getCharacterProfile({ region: "EU", realmSlug: "tarren-mill", name: "Nope" }),
    ).rejects.toMatchObject({ code: "CHARACTER_NOT_FOUND" });
  });

  it("simulates queued refresh then completes", async () => {
    const api = createMockApiClient();
    const identity = { region: "EU" as const, realmSlug: "kazzak", name: "Carryme" };
    const first = await api.getCharacterProfile(identity);
    expect(first.refreshStatus).toBe("QUEUED");
    await api.refreshCharacter(identity);
    const mid = await api.getRefreshStatus(first.characterId);
    expect(mid.refreshStatus).toBe("IN_PROGRESS");
    const done = await api.getRefreshStatus(first.characterId);
    expect(done.refreshStatus).toBe("FRESH");
    const after = await api.getCharacterProfile(identity);
    expect(after.refreshStatus).toBe("FRESH");
  });

  it("compares 2 characters with deltas", async () => {
    const api = createMockApiClient();
    const result = await api.compareCharacters({
      characters: [
        { region: "EU", realmSlug: "tarren-mill", name: "Aleria" },
        { region: "EU", realmSlug: "kazzak", name: "Carryme" },
      ],
    });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.deltasFromMedian).toBeTruthy();
  });

  it("rejects compare outside 2–10", async () => {
    const api = createMockApiClient();
    await expect(api.compareCharacters({ characters: [{ region: "EU", realmSlug: "a", name: "b" }] })).rejects.toMatchObject(
      { code: "VALIDATION_ERROR" },
    );
  });

  it("filters realms", async () => {
    const api = createMockApiClient();
    const realms = await api.searchRealms("EU", "tar");
    expect(realms.some((r) => r.slug === "tarren-mill")).toBe(true);
  });
});

describe("admin model validation", () => {
  it("accepts default weights", () => {
    const result = validateModelConfig(DEFAULT_MODEL_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.weightSum).toBeCloseTo(1, 3);
  });

  it("rejects invalid weight sums", () => {
    const bad = structuredClone(DEFAULT_MODEL_CONFIG);
    bad.weights.performance = 0.9;
    const result = validateModelConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/sum to 1/);
  });

  it("blocks activate when invalid", async () => {
    const api = createMockApiClient();
    const active = (await api.listModels()).find((m) => m.status === "ACTIVE")!;
    const draft = await api.cloneModel(active.id);
    const bad = structuredClone(DEFAULT_MODEL_CONFIG);
    bad.weights.performance = 0.99;
    await api.updateModel(draft.id, bad);
    await expect(api.activateModel(draft.id)).rejects.toMatchObject({ code: "INVALID_MODEL" });
  });
});
