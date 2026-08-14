import { createInflateRaw } from "node:zlib";
import { open, writeFile } from "node:fs/promises";
import path from "node:path";
import { AddonDbFormatError } from "./types.js";

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export async function listZipEntries(zipPath: string): Promise<ZipEntry[]> {
  const fh = await open(zipPath, "r");
  try {
    const stat = await fh.stat();
    const tailSize = Math.min(stat.size, 22 + 65535);
    const tail = Buffer.alloc(tailSize);
    await fh.read(tail, 0, tailSize, stat.size - tailSize);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new AddonDbFormatError("ZIP", "ZIP end of central directory not found");
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries: ZipEntry[] = [];
    let p = 0;
    while (p + 46 <= cd.length) {
      if (cd.readUInt32LE(p) !== CD_SIG) break;
      const compression = cd.readUInt16LE(p + 10);
      const compressedSize = cd.readUInt32LE(p + 20);
      const uncompressedSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localHeaderOffset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString("utf8");
      entries.push({ name, compression, compressedSize, uncompressedSize, localHeaderOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

export async function extractZipEntryToBuffer(zipPath: string, entry: ZipEntry): Promise<Buffer> {
  const fh = await open(zipPath, "r");
  try {
    const local = Buffer.alloc(30);
    await fh.read(local, 0, 30, entry.localHeaderOffset);
    if (local.readUInt32LE(0) !== LOCAL_SIG) {
      throw new AddonDbFormatError("ZIP", `Invalid local header for ${entry.name}`);
    }
    const nameLen = local.readUInt16LE(26);
    const extraLen = local.readUInt16LE(28);
    const dataOffset = entry.localHeaderOffset + 30 + nameLen + extraLen;
    const compressed = Buffer.alloc(entry.compressedSize);
    await fh.read(compressed, 0, entry.compressedSize, dataOffset);
    if (entry.compression === 0) return compressed;
    if (entry.compression !== 8) {
      throw new AddonDbFormatError("ZIP", `Unsupported compression ${entry.compression} for ${entry.name}`);
    }
    return inflateRaw(compressed, entry.uncompressedSize);
  } finally {
    await fh.close();
  }
}

function inflateRaw(input: Buffer, expectedSize: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const inflator = createInflateRaw();
    inflator.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > expectedSize + 1024) {
        inflator.destroy(new AddonDbFormatError("ZIP", "Inflated entry exceeded declared size"));
        return;
      }
      chunks.push(chunk);
    });
    inflator.on("error", reject);
    inflator.on("end", () => resolve(Buffer.concat(chunks)));
    inflator.end(input);
  });
}

export function findRequiredAddonEntries(entries: ZipEntry[]) {
  const lookup =
    entries.find((e) => /db_mythicplus_eu_lookup\.lua$/i.test(e.name) && /EU_M/i.test(e.name.replace(/\\/g, "/"))) ??
    entries.find((e) => /db_mythicplus_eu_lookup\.lua$/i.test(e.name));
  const characters =
    entries.find((e) => /db_mythicplus_eu_characters\.lua$/i.test(e.name) && /EU_M/i.test(e.name.replace(/\\/g, "/"))) ??
    entries.find((e) => /db_mythicplus_eu_characters\.lua$/i.test(e.name));
  const dungeons = entries.find((e) => /(^|[\\/])db_dungeons\.lua$/i.test(e.name));
  const toc = entries.find((e) => /(^|[\\/])RaiderIO\.toc$/i.test(e.name) && !/DB_/i.test(e.name));
  if (!lookup || !characters || !dungeons) {
    const sample = entries.slice(0, 30).map((e) => e.name).join(", ");
    throw new AddonDbFormatError(
      "ZIP_LAYOUT",
      `Expected RaiderIO_DB_EU_M mythicplus lua files and db_dungeons.lua were not found. sample=${sample}`,
    );
  }
  return { lookup, characters, dungeons, toc: toc ?? null };
}

export async function extractRequiredAddonFiles(
  zipPath: string,
  destDir: string,
): Promise<{ lookupPath: string; charactersPath: string; dungeonsPath: string; tocText: string | null }> {
  const entries = await listZipEntries(zipPath);
  const required = findRequiredAddonEntries(entries);
  const lookupPath = path.join(destDir, "db_mythicplus_eu_lookup.lua");
  const charactersPath = path.join(destDir, "db_mythicplus_eu_characters.lua");
  const dungeonsPath = path.join(destDir, "db_dungeons.lua");
  await writeFile(lookupPath, await extractZipEntryToBuffer(zipPath, required.lookup));
  await writeFile(charactersPath, await extractZipEntryToBuffer(zipPath, required.characters));
  await writeFile(dungeonsPath, await extractZipEntryToBuffer(zipPath, required.dungeons));
  const tocBuf = required.toc ? await extractZipEntryToBuffer(zipPath, required.toc) : null;
  return {
    lookupPath,
    charactersPath,
    dungeonsPath,
    tocText: tocBuf ? tocBuf.toString("utf8") : null,
  };
}
