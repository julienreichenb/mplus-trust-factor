import { AddonDbFormatError } from "./types.js";

const SIMPLE_ESCAPES: Record<string, number> = {
  n: 10,
  r: 13,
  t: 9,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
  "\\": 92,
  '"': 34,
  "'": 39,
};

const CHUNK_CAPACITY = 65_536;

class ByteSink {
  private chunks: Buffer[] = [];
  private chunk = Buffer.allocUnsafe(CHUNK_CAPACITY);
  private chunkLen = 0;

  pushByte(value: number): void {
    if (this.chunkLen >= this.chunk.length) {
      this.chunks.push(this.chunk.subarray(0, this.chunkLen));
      this.chunk = Buffer.allocUnsafe(CHUNK_CAPACITY);
      this.chunkLen = 0;
    }
    this.chunk[this.chunkLen++] = value & 0xff;
  }

  toUint8Array(): Uint8Array {
    if (this.chunkLen > 0) {
      this.chunks.push(this.chunk.subarray(0, this.chunkLen));
      this.chunkLen = 0;
    }
    if (this.chunks.length === 0) return new Uint8Array(0);
    if (this.chunks.length === 1) return new Uint8Array(this.chunks[0]!);
    return new Uint8Array(Buffer.concat(this.chunks));
  }
}

/** Decode a Lua long-string payload. Does not execute Lua. */
export function decodeLuaByteString(source: string): Uint8Array {
  const sink = new ByteSink();
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch !== "\\") {
      sink.pushByte(source.charCodeAt(i));
      continue;
    }
    const n = source[i + 1];
    if (n === undefined) {
      throw new AddonDbFormatError("LUA_ESCAPE", "Trailing backslash in Lua string");
    }
    if (n >= "0" && n <= "9") {
      let digits = n;
      let consumed = 1;
      if (source[i + 2] !== undefined && source[i + 2]! >= "0" && source[i + 2]! <= "9") {
        digits += source[i + 2]!;
        consumed = 2;
        if (source[i + 3] !== undefined && source[i + 3]! >= "0" && source[i + 3]! <= "9") {
          digits += source[i + 3]!;
          consumed = 3;
        }
      }
      const value = Number(digits);
      if (value > 255) {
        throw new AddonDbFormatError("LUA_ESCAPE", `Lua decimal escape ${value} > 255`);
      }
      sink.pushByte(value);
      i += consumed;
      continue;
    }
    sink.pushByte(SIMPLE_ESCAPES[n] ?? n.charCodeAt(0));
    i += 1;
  }
  return sink.toUint8Array();
}

export function encodeLuaByteString(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    if (b >= 32 && b <= 126 && b !== 34 && b !== 92) {
      out += String.fromCharCode(b);
    } else {
      out += `\\${String(b).padStart(3, "0")}`;
    }
  }
  return out;
}

export function parseAdjacentLuaStringPayload(text: string, quoteStart: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = quoteStart;
  while (i < text.length) {
    while (i < text.length && (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t")) {
      i += 1;
    }
    if (text[i] !== '"') break;
    i += 1;
    let raw = "";
    while (i < text.length) {
      if (text[i] === "\\") {
        raw += text[i] + (text[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (text[i] === '"') {
        i += 1;
        break;
      }
      raw += text[i];
      i += 1;
    }
    parts.push(decodeLuaByteString(raw));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

const LOOKUP_MARKER = "provider.lookup[1] = ";

class StreamingLuaStringPayloadDecoder {
  private phase: "ws" | "string" = "ws";
  private stringSink: ByteSink | null = null;
  private escapePending = false;
  private decimalDigits = "";
  private parts: Uint8Array[] = [];

  feed(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (this.phase === "ws") {
        if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") continue;
        if (ch !== '"') return;
        this.phase = "string";
        this.stringSink = new ByteSink();
        this.escapePending = false;
        this.decimalDigits = "";
        continue;
      }

      const sink = this.stringSink;
      if (!sink) return;

      if (this.escapePending) {
        if (ch >= "0" && ch <= "9") {
          this.decimalDigits += ch;
          if (this.decimalDigits.length >= 3) {
            const value = Number(this.decimalDigits);
            if (value > 255) {
              throw new AddonDbFormatError("LUA_ESCAPE", `Lua decimal escape ${value} > 255`);
            }
            sink.pushByte(value);
            this.escapePending = false;
            this.decimalDigits = "";
          }
          continue;
        }
        if (this.decimalDigits.length > 0) {
          const value = Number(this.decimalDigits);
          if (value > 255) {
            throw new AddonDbFormatError("LUA_ESCAPE", `Lua decimal escape ${value} > 255`);
          }
          sink.pushByte(value);
          this.decimalDigits = "";
          this.escapePending = false;
          sink.pushByte(SIMPLE_ESCAPES[ch] ?? ch.charCodeAt(0));
          continue;
        }
        sink.pushByte(SIMPLE_ESCAPES[ch] ?? ch.charCodeAt(0));
        this.escapePending = false;
        continue;
      }

      if (ch === "\\") {
        this.escapePending = true;
        this.decimalDigits = "";
        continue;
      }
      if (ch === '"') {
        this.parts.push(sink.toUint8Array());
        this.stringSink = null;
        this.phase = "ws";
        continue;
      }
      sink.pushByte(ch.charCodeAt(0));
    }
  }

  finish(): Uint8Array {
    if (this.escapePending || this.decimalDigits.length > 0 || this.stringSink) {
      throw new AddonDbFormatError("LOOKUP_MARKER", "Unterminated lookup Lua string payload");
    }
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const part of this.parts) {
      joined.set(part, offset);
      offset += part.length;
    }
    return joined;
  }
}

/** Stream-decode provider.lookup[1] payloads without retaining the full Lua source text. */
export async function loadLookupBufferFromFile(filePath: string): Promise<Uint8Array> {
  const { createReadStream } = await import("node:fs");
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: "latin1", highWaterMark: 256 * 1024 });
    let carry = "";
    let foundMarker = false;
    const decoder = new StreamingLuaStringPayloadDecoder();

    stream.on("data", (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("latin1");
      if (!foundMarker) {
        carry += text;
        const idx = carry.indexOf(LOOKUP_MARKER);
        if (idx < 0) {
          if (carry.length > LOOKUP_MARKER.length * 2) {
            carry = carry.slice(-LOOKUP_MARKER.length);
          }
          return;
        }
        foundMarker = true;
        decoder.feed(carry.slice(idx + LOOKUP_MARKER.length));
        carry = "";
        return;
      }
      decoder.feed(text);
    });

    stream.on("error", reject);
    stream.on("end", () => {
      try {
        if (!foundMarker) {
          throw new AddonDbFormatError("LOOKUP_MARKER", "provider.lookup[1] assignment not found");
        }
        resolve(decoder.finish());
      } catch (error) {
        reject(error);
      }
    });
  });
}
