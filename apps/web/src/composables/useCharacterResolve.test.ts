import { describe, expect, it, vi, beforeEach } from "vitest";
import { useCharacterResolve } from "./useCharacterResolve";

const resolveCharacter = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    resolveCharacter: (...args: unknown[]) => resolveCharacter(...args),
  },
}));

describe("useCharacterResolve", () => {
  beforeEach(() => {
    resolveCharacter.mockReset();
  });

  it("maps READY responses", async () => {
    resolveCharacter.mockResolvedValue({
      status: "READY",
      characterId: "c1",
      profilePath: "/character/EU/archimonde/Wallidrixe",
    });
    const ctrl = useCharacterResolve();
    const result = await ctrl.resolve({
      name: "Wallidrixe",
      realm: { slug: "archimonde", name: "Archimonde", region: "EU" },
    });
    expect(result?.status).toBe("READY");
    expect(ctrl.uiState.value).toBe("READY");
    expect(ctrl.profilePath.value).toContain("Wallidrixe");
  });

  it("maps NOT_FOUND without treating it as provider outage", async () => {
    resolveCharacter.mockResolvedValue({
      status: "NOT_FOUND",
      message: "Character not found on Archimonde — EU.",
    });
    const ctrl = useCharacterResolve();
    await ctrl.resolve({
      name: "Nobody",
      realm: { slug: "archimonde", name: "Archimonde", region: "EU" },
    });
    expect(ctrl.uiState.value).toBe("NOT_FOUND");
  });

  it("blocks duplicate concurrent submits", async () => {
    let release!: (value: unknown) => void;
    resolveCharacter.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const ctrl = useCharacterResolve();
    const first = ctrl.resolve({
      name: "A",
      realm: { slug: "kazzak", name: "Kazzak", region: "EU" },
    });
    const second = await ctrl.resolve({
      name: "A",
      realm: { slug: "kazzak", name: "Kazzak", region: "EU" },
    });
    expect(second).toBeNull();
    release({
      status: "READY",
      characterId: "c1",
      profilePath: "/character/EU/kazzak/A",
    });
    await first;
    expect(resolveCharacter).toHaveBeenCalledTimes(1);
  });

  it("requires both fields", async () => {
    const ctrl = useCharacterResolve();
    const result = await ctrl.resolve({
      name: " ",
      realm: { slug: "kazzak", name: "Kazzak", region: "EU" },
    });
    expect(result?.status).toBe("FAILED");
    expect(ctrl.uiState.value).toBe("TERMINAL_ERROR");
    expect(resolveCharacter).not.toHaveBeenCalled();
  });
});
