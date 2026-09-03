import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  addonDirectoryName,
  assertUniqueMp3OutputNames,
  buildVoicePackZip,
  canonicalizePackName,
  customSoundPath,
  englishFallbackPath,
  escapeLuaString,
  EXBOSS_GENERATED_ADDON_TOC_INTERFACE,
  generateAddonTextFiles,
  generateLabelsLua,
  generateSoundsLua,
  generateToc,
  mp3OutputFilename,
  requirePackName,
  tocSafeDisplayName,
  validatePackName,
} from "./exboss-voice-pack-export";
import {
  EXBOSS_VOICE_ALERTS,
  EXBOSS_VOICE_PACK_PROVENANCE,
  type ExBossVoiceAlert,
} from "./exboss-voice-pack-manifest";

const SAMPLE_NAME = "Julien's Voice / FR 🇨🇭";

function fakeMp3(marker: string): Uint8Array {
  return new TextEncoder().encode(`ID3FAKE-${marker}`);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function mustGet(files: Record<string, Uint8Array>, name: string): Uint8Array {
  const bytes = files[name];
  expect(bytes).toBeDefined();
  if (!bytes) throw new Error(`missing zip entry ${name}`);
  return bytes;
}

describe("pack naming", () => {
  it("keeps a human-readable pack name and derives a WoW-safe directory", () => {
    expect(requirePackName(SAMPLE_NAME)).toBe("Julien's Voice / FR 🇨🇭");
    expect(addonDirectoryName(SAMPLE_NAME)).toBe("EXBOSS-MT-Juliens-Voice-FR");
  });

  it("rejects empty, whitespace-only, and oversized names", () => {
    expect(validatePackName("").ok).toBe(false);
    expect(validatePackName("   ").ok).toBe(false);
    expect(validatePackName("\n\t").ok).toBe(false);
    expect(validatePackName("x".repeat(81)).ok).toBe(false);
    expect(validatePackName("x".repeat(80)).ok).toBe(true);
  });

  it("handles pathological names without colliding with EXBOSS-ENG", () => {
    expect(addonDirectoryName("!!!")).toBe("EXBOSS-MT-Custom");
    expect(addonDirectoryName("🇨🇭")).toBe("EXBOSS-MT-Custom");
    expect(addonDirectoryName("ENG")).toBe("EXBOSS-MT-ENG");
    expect(addonDirectoryName("CON")).toBe("EXBOSS-MT-CON");
    expect(addonDirectoryName("../evil")).toBe("EXBOSS-MT-evil");
    expect(addonDirectoryName("a".repeat(80)).startsWith("EXBOSS-MT-")).toBe(true);
    expect(addonDirectoryName("a".repeat(80)).length).toBeLessThanOrEqual(50);
    expect(addonDirectoryName("foo/bar\\baz:*?\"<>|")).toBe("EXBOSS-MT-foo-bar-baz");
  });

  it("strips TOC color injection but keeps non-ASCII in the visible name", () => {
    expect(canonicalizePackName("  |cffff0000Red|r pack \n")).toBe("cffff0000Redr pack");
    expect(tocSafeDisplayName("Julien #1")).toBe("Julien 1");
    expect(requirePackName("Voix FR 🇨🇭")).toBe("Voix FR 🇨🇭");
  });
});

describe("Lua escaping", () => {
  it("escapes quotes, backslashes, and newlines", () => {
    expect(escapeLuaString(`Julien's "Voice"`)).toBe(`Julien's \\"Voice\\"`);
    expect(escapeLuaString("a\\b")).toBe("a\\\\b");
    expect(escapeLuaString("line1\nline2\r")).toBe("line1\\nline2\\r");
  });
});

describe("generated addon files", () => {
  it("emits current ExBoss TOC RequiredDeps syntax and the ENG fallback dependency", () => {
    const toc = generateToc(SAMPLE_NAME);
    expect(EXBOSS_GENERATED_ADDON_TOC_INTERFACE).toBe("120100");
    expect(toc).toContain(`## Interface: ${EXBOSS_GENERATED_ADDON_TOC_INTERFACE}`);
    expect(toc).not.toContain(`## Interface: ${EXBOSS_VOICE_PACK_PROVENANCE.tocInterface}`);
    expect(EXBOSS_VOICE_PACK_PROVENANCE.tocInterface).toBe("120005,120007");
    expect(toc).toContain("## RequiredDeps: EXBOSS-ENG");
    expect(toc).toContain("## OptionalDeps: ExBoss, LibSharedMedia-3.0");
    expect(toc).toContain("## Group: EXBoss");
    expect(toc).toContain("Voice Pack: Julien's Voice / FR 🇨🇭");
    expect(toc).not.toContain("## Dependencies:");
    expect(toc).toContain("Labels.lua");
    expect(toc).toContain("Sounds.lua");
  });

  it("writes every canonical label into Labels.lua in order", () => {
    const lua = generateLabelsLua();
    expect(lua).toContain("EXBV_LABELS = {");
    expect(lua).toContain("EXBOSSEXWIND_LABELS = EXBV_LABELS");
    for (const alert of EXBOSS_VOICE_ALERTS) {
      expect(lua).toContain(`"${alert.label}"`);
    }
    const listed = [...lua.matchAll(/"([^"]+)",/g)].map((match) => match[1]);
    expect(listed).toEqual(EXBOSS_VOICE_ALERTS.map((alert) => alert.label));
  });

  it("registers every canonical label with mixed custom MP3 and ENG ogg paths", () => {
    const custom = new Set([0, 22, 184]);
    const files = generateAddonTextFiles(SAMPLE_NAME, custom);
    expect(files.addonDirectory).toBe("EXBOSS-MT-Juliens-Voice-FR");
    expect(files.soundsLua).toContain(`local PACK_NAME = "${files.packName}"`);
    expect(files.soundsLua).toContain(
      escapeLuaString(customSoundPath(files.addonDirectory, "prepare-aoe.ogg")),
    );
    expect(files.soundsLua).toContain(
      escapeLuaString(englishFallbackPath("prepare-beam.ogg")),
    );
    expect(files.soundsLua).toContain(
      escapeLuaString(customSoundPath(files.addonDirectory, "watch-knockback.ogg")),
    );
    expect(files.soundsLua).toContain(
      escapeLuaString(customSoundPath(files.addonDirectory, "std-yellow.ogg")),
    );
    expect(files.soundsLua).not.toContain(
      escapeLuaString(englishFallbackPath("prepare-aoe.ogg")),
    );

    const registered = [
      ...files.soundsLua.matchAll(/\{ "([^"]+)", "([^"]+)" \}/g),
    ];
    expect(registered).toHaveLength(EXBOSS_VOICE_ALERTS.length);
    expect(registered.map((match) => match[1])).toEqual(
      EXBOSS_VOICE_ALERTS.map((alert) => alert.label),
    );
    expect(files.soundsLua).toContain('LSM:Register("sound", "[" .. PACK_NAME .. "]" .. label, path)');
  });

  it("escapes quotes and backslashes in the human pack name inside Lua", () => {
    const lua = generateSoundsLua("EXBOSS-MT-Test", 'Pack "A"\\B', new Set());
    expect(lua).toContain('local PACK_NAME = "Pack \\"A\\"\\\\B"');
  });

  it("does not silently omit an alert when generating Sounds.lua", () => {
    const lua = generateSoundsLua("EXBOSS-MT-Test", "Test", new Set());
    for (const alert of EXBOSS_VOICE_ALERTS) {
      expect(lua).toContain(`"${alert.label}"`);
      expect(lua).toContain(escapeLuaString(englishFallbackPath(alert.filename)));
    }
  });
});

describe("MP3 filename collisions", () => {
  it("throws when two different original files would share one MP3 name", () => {
    const colliding: ExBossVoiceAlert[] = [
      { index: 0, label: "A", filename: "same.ogg", englishCue: "A" },
      { index: 1, label: "B", filename: "same.ogg", englishCue: "B" },
    ];
    expect(() => assertUniqueMp3OutputNames(colliding)).toThrow(/collision/);
  });

  it("allows the current canonical snapshot to export custom MP3 names", () => {
    expect(() => assertUniqueMp3OutputNames(EXBOSS_VOICE_ALERTS)).not.toThrow();
    expect(mp3OutputFilename("prepare-aoe.ogg")).toBe("prepare-aoe.mp3");
  });
});

describe("ZIP generation", () => {
  it("contains only the addon files plus custom MP3s, never English ogg audio", async () => {
    const customSounds = new Map<number, Uint8Array>([
      [0, fakeMp3("aoe")],
      [184, fakeMp3("yellow")],
    ]);
    const result = await buildVoicePackZip({
      packName: SAMPLE_NAME,
      customSounds,
    });
    const unzipped = unzipSync(result.zipBytes);
    const names = Object.keys(unzipped).sort();
    const dir = result.addonDirectory;

    expect(names).toEqual([
      `${dir}/${dir}.toc`,
      `${dir}/Labels.lua`,
      `${dir}/Sounds.lua`,
      `${dir}/Sounds/prepare-aoe.mp3`,
      `${dir}/Sounds/std-yellow.mp3`,
    ].sort());
    expect(names.some((name) => name.endsWith(".ogg"))).toBe(false);
    expect(names.filter((name) => name.endsWith(".mp3"))).toHaveLength(2);
    expect(decode(mustGet(unzipped, `${dir}/${dir}.toc`))).toContain("RequiredDeps: EXBOSS-ENG");
    expect(decode(mustGet(unzipped, `${dir}/Sounds.lua`))).toContain("prepare-aoe.mp3");
    expect(decode(mustGet(unzipped, `${dir}/Sounds.lua`))).toContain("std-yellow.mp3");
    expect(decode(mustGet(unzipped, `${dir}/Sounds.lua`))).toContain("prepare-beam.ogg");
    expect(result.customFilenames.sort()).toEqual(["prepare-aoe.mp3", "std-yellow.mp3"]);
  });

  it("omits Sounds/ entirely when every alert uses English fallback", async () => {
    const result = await buildVoicePackZip({
      packName: "Fallback Only",
      customSounds: new Map(),
    });
    const names = Object.keys(unzipSync(result.zipBytes));
    expect(names).toHaveLength(3);
    expect(names.some((name) => name.includes("/Sounds/"))).toBe(false);
  });

  it("rejects unknown custom indexes", async () => {
    await expect(
      buildVoicePackZip({
        packName: "Test",
        customSounds: new Map([[999, fakeMp3("nope")]]),
      }),
    ).rejects.toThrow(/Unknown alert index/);
  });
});
