import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSpellQueryXml, bindingsFromParsedSpell } from "./simc-xml.js";
import { parseSimcBinaryBanner, assertLiveSimcIdentity } from "./simc-identity.js";
import { simcArgsForQuery } from "./simc-plan.js";
import { extractSimcSpellQuerySnapshot } from "./simc-runner.js";
import { extractBlizzardRefreshSnapshot } from "./blizzard-collector.js";
import {
  REAL_SPELLQUERY_CLASS_XML,
  REAL_SPELLQUERY_RACE_XML,
  REAL_SPELLQUERY_SPEC_XML,
  SPELLQUERY_CHARGES_AND_TRIGGER_XML,
  SPELLQUERY_CLASS_SPELL_XML,
  SPELLQUERY_RACE_SPELL_XML,
  SPELLQUERY_SPEC_SPELL_XML,
} from "../fixtures/spellquery-xml.js";
import { importSimcSpellQuerySnapshot } from "../sources/simc.js";
import { runShadowCatalogRefresh } from "../pipeline.js";
import { GOLDEN_BLIZZARD_SNAPSHOT, GOLDEN_SIMC_SNAPSHOT } from "../fixtures/golden-retail.js";
import { importBlizzardRefreshSnapshot } from "../sources/blizzard.js";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function liveBanner(sha: string, mode = "Live"): string {
  const short = sha.slice(0, 7);
  return `SimulationCraft 1210-01 for World of Warcraft 12.1.0.69299 ${mode} (hotfix 2026-08-15/69299, git build midnight ${short})\n`;
}

function isProbe(args: string[]): boolean {
  return args.some((a) => a.includes("spell.id=1") || a.includes("help=1"));
}

describe("SpellQuery XML parser", () => {
  it("parses class/spec/race/cooldown/charges/stacks/trigger_spell", () => {
    const spec = parseSpellQueryXml(SPELLQUERY_SPEC_SPELL_XML);
    const storm = spec.find((s) => s.spellId === 191634)!;
    expect(storm.classSlug).toBe("shaman");
    expect(storm.specSlugs).toContain("elemental");
    expect(storm.cooldownSeconds).toBe(60);
    expect(storm.maxStack).toBe(2);
    expect(storm.triggerSpellIds).toContain(191634);
    const bindings = bindingsFromParsedSpell(storm);
    expect(bindings.some((b) => b.role === "PRIMARY_ACTIVATION")).toBe(true);
    expect(bindings.some((b) => b.role === "TRIGGERED_EFFECT")).toBe(true);
    expect(bindings.some((b) => b.role === "STACK_AURA")).toBe(false);
    const charges = parseSpellQueryXml(SPELLQUERY_CHARGES_AND_TRIGGER_XML)[0]!;
    expect(charges.charges).toBe(2);
    expect(charges.triggerSpellIds).toContain(100784);
    expect(parseSpellQueryXml(SPELLQUERY_CLASS_SPELL_XML)[0]?.classSlug).toBe("mage");
    expect(parseSpellQueryXml(SPELLQUERY_RACE_SPELL_XML).some((s) => s.isPassive === true)).toBe(true);
    expect(simcArgsForQuery("class_spell", "out.xml")[0]).toBe("ptr=0");
    expect(simcArgsForQuery("class_spell", "out.xml").some((a) => /^ptr=1$/i.test(a))).toBe(false);
    expect(simcArgsForQuery("class_spell", "out.xml").some((a) => a.includes("cooldown>=1000"))).toBe(true);
    const identity = parseSimcBinaryBanner(liveBanner(SHA), "C:\\simc.exe");
    expect(identity.dataMode).toBe("LIVE");
    expect(() => assertLiveSimcIdentity(identity, { expectedRevision: SHA })).not.toThrow();
    expect(assertLiveSimcIdentity(identity).revision.revisionPrecision).toBe("PREFIX");
    expect(assertLiveSimcIdentity(identity).revision.canonicalRevision).toBe(SHA.slice(0, 7));
    expect(
      assertLiveSimcIdentity(identity, { expectedRevision: SHA }).revision.revisionPrecision,
    ).toBe("FULL_SHA");
  });

  it("parses real SimC SpellQuery child-tag schema", () => {
    const invis = parseSpellQueryXml(REAL_SPELLQUERY_CLASS_XML)[0]!;
    expect(invis.classSlug).toBe("mage");
    expect(invis.cooldownSeconds).toBe(300);
    expect(invis.triggerSpellIds).toContain(35009);
    const ve = parseSpellQueryXml(REAL_SPELLQUERY_SPEC_XML)[0]!;
    expect(ve.spellId).toBe(15286);
    expect(ve.classSlug).toBe("priest");
    expect(ve.specSlugs).toContain("shadow");
    expect(ve.isPassive).toBe(false);
    const racials = parseSpellQueryXml(REAL_SPELLQUERY_RACE_XML);
    const stone = racials.find((s) => s.spellId === 20594)!;
    expect(stone.raceSlugs).toContain("dwarf");
    expect(stone.classSlug).toBeNull();
    const grave = racials.find((s) => s.spellId === 5227)!;
    expect(grave.isPassive).toBe(true);
    expect(grave.triggerSpellIds).toContain(127802);
    expect(grave.raceSlugs).toContain("undead");
  });

  it("rejects empty and truncated XML", () => {
    expect(() => parseSpellQueryXml("")).toThrow(/empty/);
    expect(() => parseSpellQueryXml("<spell id=\"1\" name=\"x\">")).toThrow(/truncated|missing/i);
  });
});

function scopeFromSpellQuery(query: string | undefined): string | undefined {
  if (!query) return undefined;
  if (query === "class_spell" || query === "spec_spell" || query === "race_spell") return query;
  const scope = query.match(/^(class_spell|spec_spell|race_spell)\./)?.[1];
  return scope;
}

describe("SimC extractor failures never become complete inventories", () => {
  it("rejects missing binary; revision comes from binary not env", async () => {
    await expect(
      extractSimcSpellQuerySnapshot({
        simcBin: join(tmpdir(), "no-such-simc.exe"),
      }),
    ).rejects.toMatchObject({ code: "MISSING_BINARY" });
  });

  it("maps non-zero exit, malformed XML, and partial output", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "simc-fail-"));
    writeFileSync(join(workDir, "placeholder"), "x");
    const fakeBin = join(workDir, "placeholder");

    await expect(
      extractSimcSpellQuerySnapshot({
        simcBin: fakeBin,
        workDir,
        runner: async () => ({ exitCode: 7, stdout: "out", stderr: "err" }),
      }),
    ).rejects.toMatchObject({ code: "PROCESS_FAILED" });

    await expect(
      extractSimcSpellQuerySnapshot({
        simcBin: fakeBin,
        workDir: mkdtempSync(join(tmpdir(), "simc-xml-")),
        runner: async ({ args }) => {
          if (isProbe(args)) return { exitCode: 0, stdout: liveBanner(SHA), stderr: "" };
          const xml = args.find((a) => a.startsWith("spell_query_xml_output_file="))?.slice(28);
          if (xml) writeFileSync(xml, "<not-spell-query/>");
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_XML" });

    await expect(
      extractSimcSpellQuerySnapshot({
        simcBin: fakeBin,
        workDir: mkdtempSync(join(tmpdir(), "simc-partial-")),
        runner: async ({ args }) => {
          if (isProbe(args)) return { exitCode: 0, stdout: liveBanner(SHA), stderr: "" };
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    ).rejects.toMatchObject({ code: "PARTIAL_OUTPUT" });
  });

  it("builds inventories only after successful queries without supplied revision", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "simc-ok-"));
    const fakeBin = join(workDir, "bin");
    writeFileSync(fakeBin, "x");
    const xmlByQuery: Record<string, string> = {
      class_spell: SPELLQUERY_CLASS_SPELL_XML,
      spec_spell: SPELLQUERY_SPEC_SPELL_XML,
      race_spell: SPELLQUERY_RACE_SPELL_XML,
    };
    const snapshot = await extractSimcSpellQuerySnapshot({
      simcBin: fakeBin,
      retrievedAt: "2026-08-16T12:00:00.000Z",
      workDir,
      runner: async ({ args }) => {
        if (isProbe(args)) return { exitCode: 0, stdout: liveBanner(SHA), stderr: "" };
        const q = args.find((a) => a.startsWith("spell_query="))?.slice("spell_query=".length);
        const xml = args.find((a) => a.startsWith("spell_query_xml_output_file="))?.slice(28);
        const scope = scopeFromSpellQuery(q);
        if (scope && xml) writeFileSync(xml, xmlByQuery[scope] ?? "");
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    });
    expect(snapshot.binaryIdentity?.dataMode).toBe("LIVE");
    expect(snapshot.binaryIdentity?.gitRevision).toBe(SHA.slice(0, 7));
    expect(snapshot.binaryIdentity?.revisionPrecision).toBe("PREFIX");
    expect(snapshot.simcCommitSha).toBe(SHA.slice(0, 7));
    expect(snapshot.extractionStats?.processCount).toBe(4);
    expect(snapshot.inventories.some((i) => i.kind === "SPEC" && i.queryClaim === "COMPLETE_FOR_QUERY")).toBe(
      true,
    );
    expect(snapshot.inventories.every((i) => i.claimsCompleteToolkit === false)).toBe(true);
    const imported = importSimcSpellQuerySnapshot(snapshot);
    expect(imported.records.some((r) => r.spellId === 15286)).toBe(true);
    expect(imported.identity.revisionPrecision).toBe("PREFIX");
    expect(imported.inventories.every((i) => i.claimsCompleteToolkit === false)).toBe(true);
  });

  it("expands short binary revision when expected full SHA matches", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "simc-expand-"));
    const fakeBin = join(workDir, "bin");
    writeFileSync(fakeBin, "x");
    const xmlByQuery: Record<string, string> = {
      class_spell: SPELLQUERY_CLASS_SPELL_XML,
      spec_spell: SPELLQUERY_SPEC_SPELL_XML,
      race_spell: SPELLQUERY_RACE_SPELL_XML,
    };
    const snapshot = await extractSimcSpellQuerySnapshot({
      simcBin: fakeBin,
      expectedSimcRevision: SHA,
      workDir,
      runner: async ({ args }) => {
        if (isProbe(args)) return { exitCode: 0, stdout: liveBanner(SHA), stderr: "" };
        const q = args.find((a) => a.startsWith("spell_query="))?.slice("spell_query=".length);
        const xml = args.find((a) => a.startsWith("spell_query_xml_output_file="))?.slice(28);
        const scope = scopeFromSpellQuery(q);
        if (scope && xml) writeFileSync(xml, xmlByQuery[scope] ?? "");
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    });
    expect(snapshot.simcCommitSha).toBe(SHA);
    expect(snapshot.binaryIdentity?.revisionPrecision).toBe("FULL_SHA");
    expect(snapshot.binaryIdentity?.resolvedFullRevision).toBe(SHA);
  });

  it("emits only active cooldown-bearing spells with schema-compatible output", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "simc-filter-"));
    const fakeBin = join(workDir, "bin");
    writeFileSync(fakeBin, "x");
    const xmlByQuery: Record<string, string> = {
      class_spell: SPELLQUERY_CLASS_SPELL_XML,
      spec_spell: SPELLQUERY_SPEC_SPELL_XML,
      race_spell: SPELLQUERY_RACE_SPELL_XML,
    };
    const snapshot = await extractSimcSpellQuerySnapshot({
      simcBin: fakeBin,
      workDir,
      runner: async ({ args }) => {
        if (isProbe(args)) return { exitCode: 0, stdout: liveBanner(SHA), stderr: "" };
        const q = args.find((a) => a.startsWith("spell_query="))?.slice("spell_query=".length);
        const xml = args.find((a) => a.startsWith("spell_query_xml_output_file="))?.slice(28);
        const scope = scopeFromSpellQuery(q);
        if (scope && xml) writeFileSync(xml, xmlByQuery[scope] ?? "");
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    });

    expect(snapshot.schemaVersion).toBe("simc-spellquery-export-v1");
    expect(snapshot.spells.some((s) => s.spellId === 118)).toBe(false);
    expect(snapshot.spells.some((s) => s.spellId === 20596)).toBe(false);
    expect(snapshot.spells.some((s) => s.spellId === 15286)).toBe(true);
    expect(snapshot.spells.every((s) => s.catalogRelevant === true)).toBe(true);
    expect(snapshot.spells.every((s) => s.isPassive !== true)).toBe(true);
    expect(snapshot.spells.every((s) => s.cooldownSeconds != null && s.cooldownSeconds >= 1)).toBe(true);

    const imported = importSimcSpellQuerySnapshot(snapshot);
    expect(imported.records.length).toBe(snapshot.spells.length);
    expect(imported.records.every((r) => r.catalogRelevant === true)).toBe(true);
  });

  it("fails closed on PTR, unreported revision, and expected revision mismatch", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "simc-id-"));
    const fakeBin = join(workDir, "bin");
    writeFileSync(fakeBin, "x");
    await expect(
      extractSimcSpellQuerySnapshot({
        simcBin: fakeBin,
        workDir,
        runner: async ({ args }) => {
          if (isProbe(args)) return { exitCode: 0, stdout: liveBanner(SHA, "PTR"), stderr: "" };
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    ).rejects.toMatchObject({ code: "PTR_DATA_REJECTED" });
    await expect(
      extractSimcSpellQuerySnapshot({
        simcBin: fakeBin,
        workDir,
        runner: async ({ args }) => {
          if (isProbe(args)) {
            return { exitCode: 0, stdout: "SimulationCraft 1200-01 for World of Warcraft 12.0.0 Live\n", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    ).rejects.toMatchObject({ code: "REVISION_UNREPORTED" });
    await expect(
      extractSimcSpellQuerySnapshot({
        simcBin: fakeBin,
        expectedSimcRevision: SHA,
        workDir,
        runner: async ({ args }) => {
          if (isProbe(args)) {
            return { exitCode: 0, stdout: liveBanner("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    ).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
  });
});

describe("Blizzard extractor failures", () => {
  it("maps auth/404/429/5xx and never emits complete spec toolkits", async () => {
    await expect(
      extractBlizzardRefreshSnapshot({
        region: "eu",
        locale: "en_GB",
        namespace: "static-eu",
        getter: async () => ({ statusCode: 401, data: {} }),
      }),
    ).rejects.toMatchObject({ code: "AUTH_FAILURE" });
    await expect(
      extractBlizzardRefreshSnapshot({
        region: "eu",
        locale: "en_GB",
        namespace: "static-eu",
        getter: async () => ({ statusCode: 404, data: {} }),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      extractBlizzardRefreshSnapshot({
        region: "eu",
        locale: "en_GB",
        namespace: "static-eu",
        getter: async () => ({ statusCode: 429, data: {} }),
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(
      extractBlizzardRefreshSnapshot({
        region: "eu",
        locale: "en_GB",
        namespace: "static-eu",
        getter: async () => ({ statusCode: 503, data: {} }),
      }),
    ).rejects.toMatchObject({ code: "SERVER_ERROR" });
  });

  it("imports topology without claiming spec completeness", async () => {
    const file = await extractBlizzardRefreshSnapshot({
      region: "eu",
      locale: "en_GB",
      namespace: "static-eu",
      retrievedAt: "2026-08-16T12:00:00.000Z",
      wowBuild: "12.0.0.1",
      spellIds: [12472],
      getter: async ({ path }) => {
        if (path.includes("playable-class/index")) {
          return { statusCode: 200, data: { classes: [{ id: 8, name: "Mage" }] } };
        }
        if (path.includes("playable-specialization/index")) {
          return { statusCode: 200, data: { character_specializations: [{ id: 64, name: "Frost" }] } };
        }
        if (path.includes("playable-specialization/64")) {
          return {
            statusCode: 200,
            data: { name: "Frost", playable_class: { id: 8, name: "Mage" } },
          };
        }
        if (path.includes("playable-race/index")) {
          return { statusCode: 200, data: { races: [{ id: 3, name: "Dwarf" }] } };
        }
        if (path.includes("/spell/12472")) {
          return { statusCode: 200, data: { id: 12472, name: "Icy Veins" } };
        }
        return { statusCode: 404, data: {} };
      },
    });
    const snap = importBlizzardRefreshSnapshot(file);
    expect(snap.inventories.filter((i) => i.kind === "SPEC").every((i) => !i.claimsCompleteToolkit)).toBe(
      true,
    );
    expect(snap.records.some((r) => r.spellId === 12472)).toBe(true);
  });
});

describe("unavailable sources", () => {
  it("one or both missing sources do not invent complete inventories", () => {
    const { report: none } = runShadowCatalogRefresh({
      snapshots: [],
      failedSources: ["BLIZZARD", "SIMULATIONCRAFT"],
      nowIso: "2026-08-16T12:00:00.000Z",
    });
    expect(none.diff.some((d) => d.status === "MISSING_FROM_EXTERNAL_SOURCES")).toBe(false);
    expect(none.coverage.claimedCompleteInventories).toBe(0);
    const { report: blizzardOnly } = runShadowCatalogRefresh({
      snapshots: [importBlizzardRefreshSnapshot(GOLDEN_BLIZZARD_SNAPSHOT)],
      failedSources: ["SIMULATIONCRAFT"],
      nowIso: "2026-08-16T12:00:00.000Z",
    });
    expect(blizzardOnly.quality.failedSources).toEqual(["SIMULATIONCRAFT"]);
    expect(
      blizzardOnly.coverage.inventoryScopes.filter((s) => s.source === "SIMULATIONCRAFT").length,
    ).toBe(0);
  });
});

describe("determinism", () => {
  it("identical snapshots produce identical JSON except generatedAt", () => {
    const snapshots = [
      importBlizzardRefreshSnapshot(GOLDEN_BLIZZARD_SNAPSHOT),
      importSimcSpellQuerySnapshot(GOLDEN_SIMC_SNAPSHOT),
    ];
    const a = runShadowCatalogRefresh({ snapshots, nowIso: "2026-08-16T12:00:00.000Z" });
    const b = runShadowCatalogRefresh({ snapshots, nowIso: "2026-08-16T12:00:01.000Z" });
    const strip = (report: typeof a.report) => {
      const { generatedAt: _g, ...rest } = report;
      return JSON.stringify(rest);
    };
    expect(strip(a.report)).toBe(strip(b.report));
    expect(JSON.stringify(a.candidates)).toBe(JSON.stringify(b.candidates));
  });
});
