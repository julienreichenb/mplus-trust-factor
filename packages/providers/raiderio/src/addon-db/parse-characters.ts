import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseAdjacentLuaStringPayload } from "./lua-strings.js";
import { parseProviderHeader } from "./parse-lua-meta.js";
import { AddonDbFormatError, MYTHICPLUS_ENCODING_ORDER, MYTHICPLUS_RECORD_SIZE_BYTES } from "./types.js";

async function readPrefix(filePath: string, bytes = 32_768): Promise<string> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

export async function parseNamedCharacterOffsets(charactersLuaPath: string): Promise<{
  header: ReturnType<typeof parseProviderHeader>;
  named: Array<{ realm: string; name: string; byteOffset: number }>;
}> {
  const prefix = await readPrefix(charactersLuaPath);
  const header = parseProviderHeader(prefix);
  validateHeader(header);
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
        byteOffset: offset + i * MYTHICPLUS_RECORD_SIZE_BYTES,
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

export function validateHeader(header: ReturnType<typeof parseProviderHeader>): void {
  if (header.recordSizeInBytes !== MYTHICPLUS_RECORD_SIZE_BYTES) {
    throw new AddonDbFormatError(
      "RECORD_SIZE",
      `Unexpected recordSizeInBytes ${header.recordSizeInBytes}`,
    );
  }
  if (header.encodingOrder.length !== MYTHICPLUS_ENCODING_ORDER.length) {
    throw new AddonDbFormatError("ENCODING_ORDER", "encodingOrder length drifted");
  }
  for (let i = 0; i < MYTHICPLUS_ENCODING_ORDER.length; i++) {
    if (header.encodingOrder[i] !== MYTHICPLUS_ENCODING_ORDER[i]) {
      throw new AddonDbFormatError("ENCODING_ORDER", "encodingOrder drifted from known Mythic+ packing");
    }
  }
}

export function parseTocInterface(toc: string): number | null {
  const m = toc.match(/##\s*Interface:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}
