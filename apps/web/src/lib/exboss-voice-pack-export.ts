import { strToU8, zipSync } from "fflate";
import {
  customMp3Filename,
  EXBOSS_ENG_ADDON_DIRECTORY,
  EXBOSS_VOICE_ALERTS,
  EXBOSS_VOICE_PACK_PROVENANCE,
  type ExBossVoiceAlert,
} from "./exboss-voice-pack-manifest";

export const EXBOSS_ADDON_DIRECTORY_PREFIX = "EXBOSS-MT-";
export const MAX_PACK_NAME_LENGTH = 80;
const MAX_ADDON_DIRECTORY_LENGTH = 50;

/** Current WoW Retail / Midnight 12.1.0 Interface for generated custom packs. */
export const EXBOSS_GENERATED_ADDON_TOC_INTERFACE = "120100";

export type PackNameValidation =
  | { ok: true; packName: string }
  | { ok: false; message: string };

export interface GeneratedAddonTextFiles {
  addonDirectory: string;
  packName: string;
  toc: string;
  labelsLua: string;
  soundsLua: string;
}

export type EncodedSoundBytes = Blob | Uint8Array;

export type CustomSoundBlobs = ReadonlyMap<number, EncodedSoundBytes>;

export interface VoicePackZipInput {
  packName: string;
  customSounds: CustomSoundBlobs;
  alerts?: readonly ExBossVoiceAlert[];
}

export interface VoicePackZipResult {
  addonDirectory: string;
  packName: string;
  zipBytes: Uint8Array;
  customFilenames: string[];
}

export function validatePackName(raw: string): PackNameValidation {
  if (typeof raw !== "string") {
    return { ok: false, message: "Pack name is required." };
  }
  const packName = canonicalizePackName(raw);
  if (!packName) {
    return { ok: false, message: "Pack name cannot be empty." };
  }
  if (packName.length > MAX_PACK_NAME_LENGTH) {
    return {
      ok: false,
      message: `Pack name must be at most ${MAX_PACK_NAME_LENGTH} characters.`,
    };
  }
  return { ok: true, packName };
}

export function requirePackName(raw: string): string {
  const result = validatePackName(raw);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.packName;
}

/** Keep user text, but strip TOC/LSM-unsafe control and color-escape characters. */
export function canonicalizePackName(raw: string): string {
  return raw
    .replaceAll("|", "")
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 127 ? " " : ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function tocSafeDisplayName(packName: string): string {
  return canonicalizePackName(packName).replace(/#/g, "");
}

export function addonDirectoryName(packName: string): string {
  const canonical = requirePackName(packName);
  const slug = slugifyAddonSegment(canonical) || "Custom";
  const maxBody = MAX_ADDON_DIRECTORY_LENGTH - EXBOSS_ADDON_DIRECTORY_PREFIX.length;
  let body = slug.length > maxBody ? slug.slice(0, maxBody) : slug;
  body = body.replace(/-+$/g, "").replace(/^-+/g, "");
  if (!body) body = "Custom";
  return `${EXBOSS_ADDON_DIRECTORY_PREFIX}${body}`;
}

function slugifyAddonSegment(packName: string): string {
  return packName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2018\u2019`]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function escapeLuaString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\0/g, "\\0");
}

export function wowAddonPath(...parts: string[]): string {
  return ["Interface", "AddOns", ...parts].join("\\");
}

export function customSoundPath(addonDirectory: string, filename: string): string {
  return wowAddonPath(addonDirectory, "Sounds", customMp3Filename(filename));
}

export function englishFallbackPath(filename: string): string {
  return wowAddonPath(EXBOSS_ENG_ADDON_DIRECTORY, "Sounds", filename);
}

export function mp3OutputFilename(filename: string): string {
  return customMp3Filename(filename);
}

export function assertUniqueMp3OutputNames(alerts: readonly ExBossVoiceAlert[]): void {
  const seen = new Map<string, string>();
  for (const alert of alerts) {
    const output = mp3OutputFilename(alert.filename);
    const previous = seen.get(output);
    if (previous !== undefined) {
      throw new Error(
        `Custom MP3 filename collision: "${output}" would be used by both "${previous}" and "${alert.filename}".`,
      );
    }
    seen.set(output, alert.filename);
  }
}

export function generateAddonTextFiles(
  packNameInput: string,
  customIndexes: ReadonlySet<number>,
  alerts: readonly ExBossVoiceAlert[] = EXBOSS_VOICE_ALERTS,
): GeneratedAddonTextFiles {
  const packName = requirePackName(packNameInput);
  const addonDirectory = addonDirectoryName(packName);
  assertUniqueMp3OutputNames(alerts.filter((alert) => customIndexes.has(alert.index)));

  return {
    addonDirectory,
    packName,
    toc: generateToc(packName),
    labelsLua: generateLabelsLua(alerts),
    soundsLua: generateSoundsLua(addonDirectory, packName, customIndexes, alerts),
  };
}

export function generateToc(packName: string): string {
  const titleName = tocSafeDisplayName(packName);
  return [
    `## Interface: ${EXBOSS_GENERATED_ADDON_TOC_INTERFACE}`,
    `## Title: |cffff4400Ex|r|cff00ccffBoss|r Voice Pack: ${titleName}`,
    "## Notes: Custom ExBoss voice pack generated by M+ Trust Factor. Requires the official EXBOSS-ENG pack for English fallback sounds.",
    "## Author: M+ Trust Factor",
    "## Version: 1.0.0",
    "## Group: EXBoss",
    `## RequiredDeps: ${EXBOSS_ENG_ADDON_DIRECTORY}`,
    "## OptionalDeps: ExBoss, LibSharedMedia-3.0",
    "",
    "Labels.lua",
    "Sounds.lua",
    "",
  ].join("\n");
}

export function generateLabelsLua(
  alerts: readonly ExBossVoiceAlert[] = EXBOSS_VOICE_ALERTS,
): string {
  const lines = alerts.map((alert) => ` "${escapeLuaString(alert.label)}",`);
  return [
    "---@diagnostic disable: undefined-global",
    `-- Generated by M+ Trust Factor from EXBOSS-ENG @ ${EXBOSS_VOICE_PACK_PROVENANCE.commitSha}`,
    `-- ${alerts.length} labels`,
    "",
    "EXBV_LABELS = {",
    ...lines,
    "}",
    "EXBOSSEXWIND_LABELS = EXBV_LABELS",
    "",
  ].join("\n");
}

export function generateSoundsLua(
  addonDirectory: string,
  packName: string,
  customIndexes: ReadonlySet<number>,
  alerts: readonly ExBossVoiceAlert[] = EXBOSS_VOICE_ALERTS,
): string {
  const entries = alerts.map((alert) => {
    const path = customIndexes.has(alert.index)
      ? customSoundPath(addonDirectory, alert.filename)
      : englishFallbackPath(alert.filename);
    return ` { "${escapeLuaString(alert.label)}", "${escapeLuaString(path)}" },`;
  });

  return [
    "---@diagnostic disable: undefined-global",
    `-- Generated by M+ Trust Factor from EXBOSS-ENG @ ${EXBOSS_VOICE_PACK_PROVENANCE.commitSha}`,
    `local PACK_NAME = "${escapeLuaString(packName)}"`,
    "",
    'local LSM = LibStub and LibStub("LibSharedMedia-3.0", true)',
    "if not LSM then return end",
    "",
    "local SOUNDS = {",
    ...entries,
    "}",
    "",
    "for _, entry in ipairs(SOUNDS) do",
    " local label, path = entry[1], entry[2]",
    ' LSM:Register("sound", "[" .. PACK_NAME .. "]" .. label, path)',
    "end",
    "",
  ].join("\n");
}

export async function buildVoicePackZip(input: VoicePackZipInput): Promise<VoicePackZipResult> {
  const alerts = input.alerts ?? EXBOSS_VOICE_ALERTS;
  const customIndexes = new Set(input.customSounds.keys());
  validateCustomSoundIndexes(customIndexes, alerts);

  const files = generateAddonTextFiles(input.packName, customIndexes, alerts);
  const zipFiles: Record<string, Uint8Array> = {
    [`${files.addonDirectory}/${files.addonDirectory}.toc`]: strToU8(files.toc),
    [`${files.addonDirectory}/Labels.lua`]: strToU8(files.labelsLua),
    [`${files.addonDirectory}/Sounds.lua`]: strToU8(files.soundsLua),
  };

  const customFilenames: string[] = [];
  const usedOutputs = new Map<string, number>();

  for (const alert of alerts) {
    const blob = input.customSounds.get(alert.index);
    if (!blob) continue;
    const outputName = mp3OutputFilename(alert.filename);
    const previousIndex = usedOutputs.get(outputName);
    if (previousIndex !== undefined) {
      throw new Error(
        `Custom MP3 filename collision: "${outputName}" would be written for alerts ${previousIndex} and ${alert.index}.`,
      );
    }
    usedOutputs.set(outputName, alert.index);
    customFilenames.push(outputName);
    zipFiles[`${files.addonDirectory}/Sounds/${outputName}`] = await blobToUint8Array(blob);
  }

  return {
    addonDirectory: files.addonDirectory,
    packName: files.packName,
    zipBytes: zipSync(zipFiles, { level: 6 }),
    customFilenames,
  };
}

function validateCustomSoundIndexes(
  customIndexes: ReadonlySet<number>,
  alerts: readonly ExBossVoiceAlert[],
): void {
  const known = new Set(alerts.map((alert) => alert.index));
  for (const index of customIndexes) {
    if (!known.has(index)) {
      throw new Error(`Unknown alert index ${index} in custom sound map.`);
    }
  }
}

async function blobToUint8Array(data: EncodedSoundBytes): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (typeof data.arrayBuffer === "function") {
    return new Uint8Array(await data.arrayBuffer());
  }
  const buffer = await new Response(data).arrayBuffer();
  return new Uint8Array(buffer);
}
