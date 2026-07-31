import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  extractCandidateStrings,
  findingsForText,
  isExcludedSourcePath,
  scanEnglishOnly,
  shouldSkipLiteral,
} from "./check-english-only.mjs";

test("rejects a French visible string literal", () => {
  const hits = findingsForText("Actualisation en cours", []);
  assert.ok(hits.some((h) => h.includes("Actualisation") || h.includes("french-diacritic")));
});

test("accepts an approved proper noun after allowlist strip", () => {
  const hits = findingsForText('displayLabel: "Chérith — EU"', [{ text: "Chérith", reason: "realm" }]);
  assert.deepEqual(hits, []);
});

test("does not treat a code identifier as visible copy", () => {
  const source = `
    const ActualisationStatus = profile.refreshStatus;
    if (profile.refreshStatus === "REFRESHING") return true;
  `;
  const candidates = extractCandidateStrings(source);
  assert.equal(
    candidates.filter((c) => /Actualisation/u.test(c.text)).length,
    0,
    JSON.stringify(candidates),
  );
  assert.ok(candidates.every((c) => c.text !== "REFRESHING" || shouldSkipLiteral(c.text)));
});

test("does not flag dynamic user values in Vue interpolations", () => {
  const source = `
    <template>
      <span>{{ characterName }}</span>
      <p>{{ c.name }} – {{ formatAccountMythicScore(c.rating) }}</p>
      <p title="{{ dynamicTitle }}">{{ label }}</p>
    </template>
  `;
  const candidates = extractCandidateStrings(source);
  assert.equal(candidates.length, 0, JSON.stringify(candidates));
});

test("excludes tests mocks fixtures and snapshots by path", () => {
  assert.equal(isExcludedSourcePath("src/lib/accountCharacters.test.ts"), true);
  assert.equal(isExcludedSourcePath("src/api/mock/fixtures.ts"), true);
  assert.equal(isExcludedSourcePath("src/__snapshots__/x.ts"), true);
  assert.equal(isExcludedSourcePath("src/pages/AccountPage.vue"), false);
});

test("scanEnglishOnly reports file line and matched text", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mpts-english-"));
  const allowlistPath = path.join(dir, "allowlist.json");
  fs.writeFileSync(
    allowlistPath,
    JSON.stringify({ entries: [{ text: "Chérith", reason: "proper noun" }] }),
    "utf8",
  );
  const srcRoot = path.join(dir, "src");
  fs.mkdirSync(srcRoot, { recursive: true });
  fs.writeFileSync(
    path.join(srcRoot, "BadCopy.vue"),
    `<template><p>Données à actualiser</p></template>\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(srcRoot, "OkCopy.vue"),
    `<template><p>Realm: Chérith</p></template>\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(srcRoot, "ok.ts"),
    `export const label = "Queued";\n`,
    "utf8",
  );

  const { findings, unusedAllowlist } = scanEnglishOnly({
    srcRoot,
    allowlistPath,
    webRoot: dir,
  });
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].file.replaceAll("\\", "/"), "src/BadCopy.vue");
  assert.ok(findings[0].line >= 1);
  assert.match(findings[0].text, /Données/);
  assert.deepEqual(unusedAllowlist, []);
});

test("detects unused allowlist entries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mpts-english-unused-"));
  const allowlistPath = path.join(dir, "allowlist.json");
  fs.writeFileSync(
    allowlistPath,
    JSON.stringify({
      entries: [
        { text: "Chérith", reason: "used" },
        { text: "Français", reason: "unused on purpose" },
      ],
    }),
    "utf8",
  );
  const srcRoot = path.join(dir, "src");
  fs.mkdirSync(srcRoot, { recursive: true });
  fs.writeFileSync(path.join(srcRoot, "a.ts"), `export const x = "Chérith";\n`, "utf8");

  const { findings, unusedAllowlist } = scanEnglishOnly({
    srcRoot,
    allowlistPath,
    webRoot: dir,
  });
  assert.deepEqual(findings, []);
  assert.deepEqual(unusedAllowlist, ["Français"]);
});
