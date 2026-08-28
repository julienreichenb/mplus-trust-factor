import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CURRENT_CATALOG_VERSION_ID,
  getAllRegisteredRules,
  RETAIL_ABILITY_CATALOG,
  resolveAbilityRuleBySpellId,
} from "../index.js";
import { RETAIL_CLASS_MATRIX } from "../catalog/classes-matrix.js";
import {
  allResolvableSpellIdsFromRules,
  BOOTSTRAP_WOW_BUILD,
  compileBootstrapRelease0,
  currentStaticReleaseTopology,
  resolveAbilityRuleBySpellIdFromArtifact,
} from "./index.js";

describe("Bootstrap Release 0", () => {
  const result = compileBootstrapRelease0({ generatedAt: "2026-08-16T12:00:00.000Z" });

  it("uses the real static catalog with 311 rules and legacy version metadata", () => {
    const rules = getAllRegisteredRules();
    expect(rules).toHaveLength(311);
    expect(RETAIL_ABILITY_CATALOG.rules).toHaveLength(311);
    expect(result.artifact.rules).toHaveLength(rules.length);
    expect(result.artifact.manifest.staticCatalogVersionId).toBe(CURRENT_CATALOG_VERSION_ID);
    expect(CURRENT_CATALOG_VERSION_ID).toBe("12.0.0/midnight-season-1");
    expect(result.artifact.gameVersion).toBe("12.0.0");
    expect(result.artifact.seasonSlug).toBe("midnight-season-1");
    expect(result.artifact.wowBuild).toBe(BOOTSTRAP_WOW_BUILD);
    expect(result.artifact.manifest.origin).toBe("BOOTSTRAP_STATIC_CATALOG");
    expect(result.artifact.manifest.curatedChangeIds).toEqual([]);
  });

  it("matches exact canonicalKey set", () => {
    const staticKeys = [...RETAIL_ABILITY_CATALOG.rules.map((r) => r.canonicalKey)].sort();
    const artifactKeys = result.artifact.rules.map((r) => r.canonicalKey);
    expect(artifactKeys).toEqual(staticKeys);
  });

  it("embeds current runtime topology without Haranir", () => {
    const topo = currentStaticReleaseTopology();
    expect(result.artifact.topology.classes.map((c) => c.slug)).toEqual(
      topo.classes.map((c) => c.slug),
    );
    expect(result.topology.classCount).toBe(RETAIL_CLASS_MATRIX.length);
    expect(result.topology.specCount).toBe(
      RETAIL_CLASS_MATRIX.reduce((n, c) => n + c.specs.length, 0),
    );
    const raceSlugs = result.artifact.topology.races.map((r) => r.slug);
    expect(raceSlugs).not.toContain("haranir");
    expect(raceSlugs).toContain("human");
    expect(raceSlugs).toContain("earthen");
    const devourer = result.artifact.topology.classes
      .find((c) => c.slug === "demon-hunter")
      ?.specs.find((s) => s.slug === "devourer");
    expect(devourer?.blizzardSpecId).toBe(1480);
  });

  it("passes full static↔artifact parity", () => {
    expect(result.validation.valid).toBe(true);
    expect(result.parity.overall).toBe("PASS");
    expect(result.parity.fieldParity.equal).toBe(true);
    expect(result.parity.validationParity.equal).toBe(true);
    expect(result.parity.roundTripParity.equal).toBe(true);
  });

  it("resolution-parity covers every resolvable spell id plus unknown", () => {
    const ids = allResolvableSpellIdsFromRules(RETAIL_ABILITY_CATALOG.rules);
    expect(result.parity.resolverParity.spellIdsChecked).toBe(ids.length + 1);
    expect(result.parity.resolverParity.mismatches).toEqual([]);
    for (const spellId of ids) {
      const left = resolveAbilityRuleBySpellId({ spellId });
      const right = resolveAbilityRuleBySpellIdFromArtifact(result.artifact, { spellId });
      expect(right.status).toBe(left.status);
      if (left.status === "matched" && right.status === "matched") {
        expect(right.rule.canonicalKey).toBe(left.rule.canonicalKey);
      }
    }
    const unknown = resolveAbilityRuleBySpellIdFromArtifact(result.artifact, {
      spellId: 9_999_999_001,
    });
    expect(unknown.status).toBe("unmatched");
  });

  it("checks every class/spec scope including healers/tanks/DPS/Devourer", () => {
    expect(result.parity.scopeParity.classSpecScopesChecked).toBe(
      RETAIL_CLASS_MATRIX.reduce((n, c) => n + c.specs.length, 0),
    );
    expect(result.parity.scopeParity.mismatches).toEqual([]);
    expect(result.parity.racialParity.mismatches).toEqual([]);
  });
});

describe("release compiler trust boundary", () => {
  it("does not import SimC / Blizzard / WCL extractors from release modules", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = [
      "compile.ts",
      "bootstrap.ts",
      "normalize.ts",
      "topology.ts",
      "parity.ts",
      "shadow-catalog.ts",
      "validate-artifact.ts",
      "canonicalize.ts",
      "types.ts",
      "index.ts",
    ];
    const forbidden = [
      "refresh/extract/",
      "refresh/sources/simc",
      "refresh/sources/blizzard",
      "offensive/sources/",
      "warcraftlogs",
      "wowhead",
    ];
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      for (const pattern of forbidden) {
        expect(text.includes(pattern), `${file} must not reference ${pattern}`).toBe(false);
      }
    }
  });
});
