#!/usr/bin/env node
/**
 * English-only regression scanner for apps/web user-visible copy.
 *
 * Responsibility: inspect source for French product copy in string literals and
 * Vue template static text. Does not introduce an i18n framework.
 *
 * Scope: apps/web/src **.{vue,ts,tsx}
 * Excludes: tests, mocks/fixtures, generated/build output, dependencies, snapshots.
 * Candidates: quoted string literals + Vue template text / selected attributes.
 * Non-candidates: identifiers, comments, `{{ interpolations }}`, import paths.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = path.resolve(__dirname, "..");
export const SRC_ROOT = path.join(WEB_ROOT, "src");
export const ALLOWLIST_PATH = path.join(WEB_ROOT, "english-allowlist.json");

const FRENCH_DIACRITICS = /[àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/u;
const FRENCH_LEXEMES = [
  /\bAucun\b/u,
  /\bPersonnage\b/u,
  /\bDonnées\b/u,
  /\bActualisation\b/u,
  /\bcalculé\b/iu,
  /\bChanger de\b/u,
  /\bMes personnages\b/u,
];

/** Paths (posix, relative to apps/web) that must not be scanned. */
const EXCLUDED_PATH_FRAGMENTS = [
  "/node_modules/",
  "/dist/",
  "/__snapshots__/",
  "/api/mock/",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  ".spec.tsx",
];

const SKIP_LITERAL_RE =
  /^(?:https?:\/\/|\/|\.\/|\.\.\/|[A-Za-z]:\\|[\w.-]+\.(?:ts|js|vue|css|json|svg|png|jpg)|@[\w/-]+)/u;

/**
 * @param {string} dir
 * @param {(filePath: string) => void} visit
 */
function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__snapshots__") {
        continue;
      }
      walk(full, visit);
      continue;
    }
    if (!entry.isFile()) continue;
    if (/\.(?:vue|ts|tsx)$/u.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(entry.name)) {
      visit(full);
    }
  }
}

/**
 * @param {string} relPosix
 */
export function isExcludedSourcePath(relPosix) {
  const normalized = relPosix.startsWith("/") ? relPosix : `/${relPosix}`;
  return EXCLUDED_PATH_FRAGMENTS.some((frag) => normalized.includes(frag));
}

/**
 * @param {string} value
 */
export function shouldSkipLiteral(value) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (SKIP_LITERAL_RE.test(trimmed)) return true;
  // Punctuation / whitespace only (e.g. leftover en-dashes between interpolations).
  if (!/\p{L}/u.test(trimmed)) return true;
  // Single-token technical enums / keys (no spaces) that are not product sentences.
  if (/^[A-Z][A-Z0-9_]{2,}$/u.test(trimmed)) return true;
  return false;
}

/**
 * @param {string} source
 * @returns {Array<{ line: number, text: string, kind: string }>}
 */
export function extractCandidateStrings(source) {
  /** @type {Array<{ line: number, text: string, kind: string }>} */
  const out = [];

  // Vue SFC: split template vs script roughly by tags.
  const templateMatch = source.match(/<template\b[^>]*>([\s\S]*?)<\/template>/iu);
  if (templateMatch && templateMatch.index != null) {
    const templateBody = templateMatch[1] ?? "";
    const startLine = source.slice(0, templateMatch.index).split(/\r?\n/).length;
    extractVueTemplateCandidates(templateBody, startLine, out);
  }

  // Script / plain TS: string literals only (comments ignored).
  const scriptChunks = [];
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/giu;
  let m;
  let foundScript = false;
  while ((m = scriptRe.exec(source)) !== null) {
    foundScript = true;
    const body = m[1] ?? "";
    const startLine = source.slice(0, m.index).split(/\r?\n/).length;
    scriptChunks.push({ body, startLine });
  }
  if (!foundScript && !templateMatch) {
    scriptChunks.push({ body: source, startLine: 1 });
  }
  for (const chunk of scriptChunks) {
    extractScriptStringLiterals(chunk.body, chunk.startLine, out);
  }

  // Also scan non-script/non-template remainder? For .vue style blocks skip.
  return out;
}

/**
 * @param {string} body
 * @param {number} startLine
 * @param {Array<{ line: number, text: string, kind: string }>} out
 */
function extractScriptStringLiterals(body, startLine, out) {
  let i = 0;
  let line = startLine;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (ch === "/" && body[i + 1] === "/") {
      while (i < body.length && body[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && body[i + 1] === "*") {
      i += 2;
      while (i < body.length && !(body[i] === "*" && body[i + 1] === "/")) {
        if (body[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      let text = "";
      const litLine = line;
      while (i < body.length) {
        if (body[i] === "\\") {
          text += body[i] + (body[i + 1] ?? "");
          if (body[i + 1] === "\n") line += 1;
          i += 2;
          continue;
        }
        if (body[i] === "\n") line += 1;
        if (body[i] === quote) {
          i += 1;
          break;
        }
        text += body[i];
        i += 1;
      }
      // Skip template-literal interpolations content markers — keep static parts only.
      const staticParts =
        quote === "`" ? text.split(/\$\{[\s\S]*?\}/u).filter(Boolean) : [text];
      for (const part of staticParts) {
        const decoded = part.replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"');
        if (shouldSkipLiteral(decoded)) continue;
        out.push({ line: litLine, text: decoded, kind: "string-literal" });
      }
      continue;
    }
    i += 1;
  }
}

/**
 * @param {string} templateBody
 * @param {number} startLine
 * @param {Array<{ line: number, text: string, kind: string }>} out
 */
function extractVueTemplateCandidates(templateBody, startLine, out) {
  // Attribute values for user-facing attrs.
  const attrRe =
    /\b(?:title|aria-label|aria-description|aria-placeholder|placeholder|alt|label)\s*=\s*(["'])([\s\S]*?)\1/giu;
  let am;
  while ((am = attrRe.exec(templateBody)) !== null) {
    const before = templateBody.slice(0, am.index);
    const line = startLine + before.split(/\r?\n/).length - 1;
    const value = am[2] ?? "";
    if (shouldSkipLiteral(value)) continue;
    if (value.includes("{{")) continue;
    out.push({ line, text: value, kind: "template-attr" });
  }

  // Static text nodes: strip tags, comments, interpolations.
  const withoutComments = templateBody.replace(/<!--[\s\S]*?-->/gu, "");
  const withoutInterps = withoutComments.replace(/\{\{[\s\S]*?\}\}/gu, " ");
  const withoutTags = withoutInterps.replace(/<[^>]+>/gu, "\n");
  const chunks = withoutTags.split(/\r?\n/);
  // Approximate line numbers by scanning original template with a cursor.
  let searchFrom = 0;
  for (const raw of chunks) {
    const text = raw.replace(/\s+/gu, " ").trim();
    if (!text) continue;
    if (shouldSkipLiteral(text)) continue;
    const idx = templateBody.indexOf(raw.trim(), searchFrom);
    const pos = idx >= 0 ? idx : searchFrom;
    if (idx >= 0) searchFrom = idx + raw.trim().length;
    const line = startLine + templateBody.slice(0, pos).split(/\r?\n/).length - 1;
    out.push({ line, text, kind: "template-text" });
  }
}

/**
 * @param {string} text
 * @param {Array<{ text: string, reason?: string }>} entries
 */
export function stripAllowlist(text, entries) {
  let next = text;
  for (const entry of entries) {
    if (!entry?.text) continue;
    next = next.split(entry.text).join(" ");
  }
  return next;
}

/**
 * @param {string} text
 * @param {Array<{ text: string, reason?: string }>} entries
 * @returns {string[]}
 */
export function findingsForText(text, entries) {
  const checked = stripAllowlist(text, entries);
  /** @type {string[]} */
  const hits = [];
  const dia = checked.match(FRENCH_DIACRITICS);
  if (dia) hits.push(`french-diacritic:${dia[0]}`);
  for (const re of FRENCH_LEXEMES) {
    const m = checked.match(re);
    if (m) hits.push(`lexeme:${m[0]}`);
  }
  return hits;
}

/**
 * @param {string} allowlistPath
 * @returns {{ entries: Array<{ text: string, reason: string }>, raw: unknown }}
 */
export function loadAllowlist(allowlistPath) {
  const raw = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
  /** @type {Array<{ text: string, reason: string }>} */
  let entries = [];
  if (Array.isArray(raw.entries)) {
    entries = raw.entries.map((e) => ({
      text: String(e.text ?? ""),
      reason: String(e.reason ?? ""),
    }));
  } else if (Array.isArray(raw.allowlist)) {
    // Legacy shape.
    entries = raw.allowlist.map((text) => ({ text: String(text), reason: "" }));
  }
  entries = entries.filter((e) => e.text.length > 0);
  return { entries, raw };
}

/**
 * @param {{ srcRoot?: string, allowlistPath?: string, webRoot?: string }} [options]
 */
export function scanEnglishOnly(options = {}) {
  const webRoot = options.webRoot ?? WEB_ROOT;
  const srcRoot = options.srcRoot ?? SRC_ROOT;
  const allowlistPath = options.allowlistPath ?? ALLOWLIST_PATH;
  const { entries } = loadAllowlist(allowlistPath);

  /** @type {Array<{ file: string, line: number, text: string, reasons: string[], kind: string }>} */
  const findings = [];
  /** @type {Set<string>} */
  const seenAllowlistHits = new Set();

  walk(srcRoot, (filePath) => {
    const rel = path.relative(webRoot, filePath).split(path.sep).join("/");
    if (isExcludedSourcePath(rel)) return;
    const source = fs.readFileSync(filePath, { encoding: "utf8" });
    const candidates = extractCandidateStrings(source);
    for (const c of candidates) {
      for (const entry of entries) {
        if (c.text.includes(entry.text)) seenAllowlistHits.add(entry.text);
      }
      const reasons = findingsForText(c.text, entries);
      if (reasons.length === 0) continue;
      findings.push({
        file: rel,
        line: c.line,
        text: c.text.trim().slice(0, 200),
        reasons,
        kind: c.kind,
      });
    }
  });

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const unusedAllowlist = entries
    .filter((e) => !seenAllowlistHits.has(e.text))
    .map((e) => e.text)
    .sort((a, b) => a.localeCompare(b));

  return { findings, allowlist: entries.map((e) => e.text).sort(), unusedAllowlist };
}

export function formatFindingsReport(findings, unusedAllowlist) {
  const lines = [];
  if (findings.length > 0) {
    lines.push(`english-only check: ${findings.length} unapproved occurrence(s)`);
    for (const f of findings) {
      lines.push(`${f.file}:${f.line}: [${f.reasons.join(",")}] (${f.kind}) ${f.text}`);
    }
  }
  if (unusedAllowlist.length > 0) {
    lines.push(`english-only check: ${unusedAllowlist.length} unused allowlist entr${unusedAllowlist.length === 1 ? "y" : "ies"}`);
    for (const text of unusedAllowlist) {
      lines.push(`unused-allowlist: ${text}`);
    }
  }
  return lines.join("\n");
}

function main() {
  const { findings, unusedAllowlist } = scanEnglishOnly();
  if (findings.length === 0 && unusedAllowlist.length === 0) {
    process.stdout.write("english-only check: ok\n");
    process.exit(0);
  }
  process.stderr.write(`${formatFindingsReport(findings, unusedAllowlist)}\n`);
  process.exit(1);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entry === import.meta.url) {
  main();
}
