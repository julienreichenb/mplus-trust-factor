import { describe, expect, it } from "vitest";
import {
  EXBOSS_VOICE_ALERTS,
  EXBOSS_VOICE_PACK_PROVENANCE,
  customMp3Filename,
  oggStem,
} from "./exboss-voice-pack-manifest";

describe("ExBoss voice-pack manifest", () => {
  it("pins provenance and the canonical alert count", () => {
    expect(EXBOSS_VOICE_PACK_PROVENANCE.repository).toBe("https://github.com/aizuon/EXBOSS");
    expect(EXBOSS_VOICE_PACK_PROVENANCE.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(EXBOSS_VOICE_PACK_PROVENANCE.commitSha).toBe(
      "57c3a78ef17c1b4e2a746e04b7700c8ee77c504b",
    );
    expect(EXBOSS_VOICE_PACK_PROVENANCE.tocInterface).toBe("120005,120007");
    expect(EXBOSS_VOICE_PACK_PROVENANCE.alertCount).toBe(185);
    expect(EXBOSS_VOICE_ALERTS).toHaveLength(185);
    expect(EXBOSS_VOICE_ALERTS).toHaveLength(EXBOSS_VOICE_PACK_PROVENANCE.alertCount);
  });

  it("preserves canonical order and 0-based indexes", () => {
    expect(EXBOSS_VOICE_ALERTS[0]).toMatchObject({
      index: 0,
      label: "准备AOE",
      filename: "prepare-aoe.ogg",
    });
    expect(EXBOSS_VOICE_ALERTS[184]).toMatchObject({
      index: 184,
      label: "黄色",
      filename: "std-yellow.ogg",
    });
    expect(EXBOSS_VOICE_ALERTS.map((alert) => alert.index)).toEqual(
      EXBOSS_VOICE_ALERTS.map((_, index) => index),
    );
  });

  it("requires non-empty labels, English cues, and .ogg filenames", () => {
    for (const alert of EXBOSS_VOICE_ALERTS) {
      expect(alert.label.trim().length).toBeGreaterThan(0);
      expect(alert.englishCue.trim().length).toBeGreaterThan(0);
      expect(alert.filename).toMatch(/^[A-Za-z0-9][A-Za-z0-9.-]*\.ogg$/);
      expect(alert.filename.endsWith(".ogg")).toBe(true);
      expect(oggStem(alert.filename).includes(".")).toBe(false);
    }
  });

  it("documents current-snapshot uniqueness without treating it as a hard upstream guarantee", () => {
    const labels = EXBOSS_VOICE_ALERTS.map((alert) => alert.label);
    const filenames = EXBOSS_VOICE_ALERTS.map((alert) => alert.filename);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(filenames).size).toBe(filenames.length);
    expect(new Set(filenames.map(customMp3Filename)).size).toBe(filenames.length);
  });
});
