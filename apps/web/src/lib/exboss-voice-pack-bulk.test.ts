import { describe, expect, it } from "vitest";
import type { ExBossVoiceAlert } from "./exboss-voice-pack-manifest";
import {
  alertFamilyKey,
  scoreCueSimilarity,
  suggestBulkTargets,
} from "./exboss-voice-pack-bulk";

const ALERTS: ExBossVoiceAlert[] = [
  { index: 0, label: "准备AOE", filename: "prepare-aoe.ogg", englishCue: "Prepare AOE" },
  { index: 1, label: "准备打断", filename: "prepare-interrupt.ogg", englishCue: "Prepare interrupt" },
  { index: 2, label: "黄色", filename: "std-yellow.ogg", englishCue: "Yellow" },
  { index: 3, label: "你是白色", filename: "you-white.ogg", englishCue: "You are white" },
  { index: 4, label: "黑色", filename: "std-black.ogg", englishCue: "Black" },
  { index: 5, label: "打断施法", filename: "std-interrupt.ogg", englishCue: "Interrupt" },
];

describe("exboss voice pack bulk suggestions", () => {
  it("groups prepare and color families", () => {
    expect(alertFamilyKey("prepare-aoe.ogg")).toBe("prepare");
    expect(alertFamilyKey("std-yellow.ogg")).toBe("color");
    expect(alertFamilyKey("you-white.ogg")).toBe("color");
  });

  it("scores shared cue tokens", () => {
    expect(scoreCueSimilarity("Prepare AOE", "Prepare interrupt")).toBeGreaterThan(0.2);
    expect(scoreCueSimilarity("Yellow", "Black")).toBe(0);
  });

  it("suggests family and similar targets for a prepare alert", () => {
    const fromPrepare = suggestBulkTargets(ALERTS, 0);
    expect(fromPrepare.map((row) => row.index)).toContain(1);
    expect(fromPrepare.find((row) => row.index === 1)?.reasons).toContain("family");

    const fromPrepareInterrupt = suggestBulkTargets(ALERTS, 1);
    expect(fromPrepareInterrupt.map((row) => row.index)).toContain(5);
    expect(fromPrepareInterrupt.find((row) => row.index === 5)?.reasons).toContain("similar");
  });
});
