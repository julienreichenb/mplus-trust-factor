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

/** Decode a Lua long-string payload. Does not execute Lua. */
export function decodeLuaByteString(source: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch !== "\\") {
      out.push(source.charCodeAt(i) & 0xff);
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
      out.push(value);
      i += consumed;
      continue;
    }
    out.push(SIMPLE_ESCAPES[n] ?? n.charCodeAt(0));
    i += 1;
  }
  return Uint8Array.from(out);
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
