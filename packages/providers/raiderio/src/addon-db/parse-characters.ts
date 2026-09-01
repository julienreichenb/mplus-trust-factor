import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseAdjacentLuaStringPayload } from "./lua-strings.js";
import { parseProviderHeader } from "./parse-lua-meta.js";
import {
  assertPackedLayoutMatchesRecordSize,
  layoutFromProviderHeader,
} from "./packed-layout.js";
import { AddonDbFormatError, MYTHICPLUS_RECORD_SIZE_BYTES } from "./types.js";

async function readPrefix(filePath: string, bytes = 32_768): Promise<string> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString("latin1");
  } finally {
    await fh.close();
  }
}

/** Read the first bytes of an addon Lua file without loading the full corpus. */
export async function readAddonFilePrefix(filePath: string, bytes = 32_768): Promise<string> {
  return readPrefix(filePath, bytes);
}

export async function parseNamedCharacterOffsets(
  charactersLuaPath: string,
  recordSizeInBytes: number = MYTHICPLUS_RECORD_SIZE_BYTES,
): Promise<{
  header: ReturnType<typeof parseProviderHeader>;
  named: Array<{ realm: string; name: string; byteOffset: number }>;
}> {
  const prefix = await readPrefix(charactersLuaPath);
  const header = parseProviderHeader(prefix);
  const recordSize = recordSizeInBytes > 0 ? recordSizeInBytes : MYTHICPLUS_RECORD_SIZE_BYTES;
  const stream = createReadStream(charactersLuaPath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const named: Array<{ realm: string; name: string; byteOffset: number }> = [];
  for await (const line of rl) {
    const m = line.match(/provider\.db\["((?:\\.|[^"\\])*)"\]=\{(\d+),(.+)\} end F\(\)/);
    if (!m) continue;
    const realm = m[1] ?? "";
    const offset = Number(m[2]);
    const names: string[] = [];
    const nameRe = /"((?:\\.|[^"\\])*)"/g;
    let nm: RegExpExecArray | null;
    const namesPart = m[3] ?? "";
    while ((nm = nameRe.exec(namesPart))) names.push(nm[1] ?? "");
    for (let i = 0; i < names.length; i++) {
      named.push({
        realm,
        name: names[i] ?? "",
        byteOffset: offset + i * recordSize,
      });
    }
  }
  return { header, named };
}

export function loadLookupBuffer(lookupLuaText: string): Uint8Array {
  const marker = "provider.lookup[1] = ";
  const start = lookupLuaText.indexOf(marker);
  if (start < 0) {
    throw new AddonDbFormatError("LOOKUP_MARKER", "provider.lookup[1] assignment not found");
  }
  const quote = lookupLuaText.indexOf('"', start + marker.length);
  if (quote < 0) {
    throw new AddonDbFormatError("LOOKUP_MARKER", "lookup payload quote not found");
  }
  return parseAdjacentLuaStringPayload(lookupLuaText, quote);
}

export function validatePackedProviderHeader(header: ReturnType<typeof parseProviderHeader>): void {
  if (header.recordSizeInBytes <= 0) {
    throw new AddonDbFormatError("RECORD_SIZE", "recordSizeInBytes is missing from the addon provider header");
  }
  if (header.encodingOrder.length === 0) {
    throw new AddonDbFormatError("ENCODING_ORDER", "encodingOrder is missing from the addon provider header");
  }
  assertPackedLayoutMatchesRecordSize(layoutFromProviderHeader(header), header.recordSizeInBytes);
}

/** @deprecated Prefer validatePackedProviderHeader; kept for callers that still pass a characters-file header. */
export function validateHeader(header: ReturnType<typeof parseProviderHeader>): void {
  if (header.encodingOrder.length === 0 || header.recordSizeInBytes <= 0) {
    return;
  }
  validatePackedProviderHeader(header);
}

export function parseTocInterface(toc: string): number | null {
  const m = toc.match(/##\s*Interface:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}
