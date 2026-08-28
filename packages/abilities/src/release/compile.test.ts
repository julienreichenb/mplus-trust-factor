import { describe, expect, it } from "vitest";
import { getAllRegisteredRules } from "../registry.js";
import {
  BOOTSTRAP_WOW_BUILD,
  buildReleaseKey,
  compileAbilityCatalogRelease,
  contentDigestOf,
  buildReleaseContent,
  currentStaticReleaseTopology,
  normalizeRulesForContent,
  validateAbilityCatalogReleaseArtifact,
  ABILITY_CATALOG_RELEASE_SCHEMA_V1,
} from "./index.js";
import {
  CATALOG_GAME_VERSION,
  CATALOG_SEASON_SLUG,
  CURRENT_CATALOG_VERSION_ID,
} from "../version.js";
import type { AbilityRule } from "../types.js";

function compileFixture(overrides?: {
  rules?: AbilityRule[];
  generatedAt?: string;
  wowBuild?: string;
  changes?: Parameters<typeof compileAbilityCatalogRelease>[0]["changes"];
}) {
  const rules = overrides?.rules ?? getAllRegisteredRules().slice(0, 3);
  return compileAbilityCatalogRelease({
    baseRules: rules,
    baseTopology: currentStaticReleaseTopology(),
    changes: overrides?.changes ?? [],
    gameVersion: CATALOG_GAME_VERSION,
    wowBuild: overrides?.wowBuild ?? BOOTSTRAP_WOW_BUILD,
    seasonSlug: CATALOG_SEASON_SLUG,
    previousReleaseId: null,
    manifest: {
      origin: "BOOTSTRAP_STATIC_CATALOG",
      staticCatalogVersionId: CURRENT_CATALOG_VERSION_ID,
      curatedChangeIds: [],
    },
    generatedAt: overrides?.generatedAt ?? "2026-08-16T00:00:00.000Z",
  });
}

describe("ability catalog release compiler", () => {
  it("is deterministic for identical inputs", () => {
    const a = compileFixture({ generatedAt: "2026-01-01T00:00:00.000Z" });
    const b = compileFixture({ generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(a.contentDigest).toBe(b.contentDigest);
    expect(a.releaseKey).toBe(b.releaseKey);
    expect(a.rules.map((r) => r.canonicalKey)).toEqual(b.rules.map((r) => r.canonicalKey));
  });

  it("orders rules by canonicalKey ascending", () => {
    const rules = getAllRegisteredRules().slice(0, 5);
    const shuffled = [...rules].reverse();
    const artifact = compileFixture({ rules: shuffled });
    const keys = artifact.rules.map((r) => r.canonicalKey);
    expect(keys).toEqual([...keys].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });

  it("orders topology classes and specs deterministically", () => {
    const artifact = compileFixture();
    const classSlugs = artifact.topology.classes.map((c) => c.slug);
    expect(classSlugs).toEqual([...classSlugs].sort());
    for (const cls of artifact.topology.classes) {
      const specs = cls.specs.map((s) => s.slug);
      expect(specs).toEqual([...specs].sort());
    }
    const races = artifact.topology.races.map((r) => r.slug);
    expect(races).toEqual([...races].sort());
  });

  it("excludes volatile generatedAt from contentDigest", () => {
    const a = compileFixture({ generatedAt: "2020-01-01T00:00:00.000Z" });
    const b = compileFixture({ generatedAt: "2099-12-31T23:59:59.000Z" });
    expect(a.contentDigest).toBe(b.contentDigest);
    expect(a.releaseKey).toBe(b.releaseKey);
    expect(a.generatedAt).not.toBe(b.generatedAt);
  });

  it("changes digest when a semantic field changes", () => {
    const base = getAllRegisteredRules().slice(0, 2);
    const a = compileFixture({ rules: base });
    const mutated = structuredClone(base);
    mutated[0] = { ...mutated[0]!, name: `${mutated[0]!.name}-CHANGED` };
    const b = compileFixture({ rules: mutated });
    expect(b.contentDigest).not.toBe(a.contentDigest);
    expect(b.releaseKey).not.toBe(a.releaseKey);
  });

  it("same content produces same releaseKey", () => {
    const a = compileFixture();
    expect(a.releaseKey).toBe(buildReleaseKey(a.wowBuild, a.contentDigest));
    expect(a.releaseKey).toMatch(/^wow-unknown-static\/catalog-v1\/[a-f0-9]{8}$/);
  });

  it("rejects duplicate canonicalKey in base", () => {
    const rules = getAllRegisteredRules().slice(0, 1);
    const dup = [...rules, structuredClone(rules[0]!)];
    expect(() => compileFixture({ rules: dup })).toThrow(/Duplicate canonicalKey/);
  });

  it("rejects malformed empty spellIds via artifact validator", () => {
    const rules = normalizeRulesForContent(getAllRegisteredRules().slice(0, 1));
    const bad = [{ ...rules[0]!, spellIds: [] }];
    const artifact = compileFixture({ rules: bad });
    const report = validateAbilityCatalogReleaseArtifact(artifact);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "EMPTY_SPELL_IDS")).toBe(true);
  });

  it("rejects unsupported schema", () => {
    const artifact = compileFixture();
    const report = validateAbilityCatalogReleaseArtifact({
      ...artifact,
      schemaVersion: "ability-catalog-release-v999",
    });
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "UNSUPPORTED_SCHEMA")).toBe(true);
  });

  it("rejects corrupt contentDigest", () => {
    const artifact = compileFixture();
    const report = validateAbilityCatalogReleaseArtifact({
      ...artifact,
      contentDigest: "0".repeat(64),
    });
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "CONTENT_DIGEST_MISMATCH")).toBe(true);
  });

  it("round-trips compile → content → compile with stable digest", () => {
    const first = compileFixture({ generatedAt: "2026-08-01T00:00:00.000Z" });
    const second = compileAbilityCatalogRelease({
      baseRules: first.rules,
      baseTopology: first.topology,
      changes: [],
      gameVersion: first.gameVersion,
      wowBuild: first.wowBuild,
      seasonSlug: first.seasonSlug,
      previousReleaseId: first.previousReleaseId,
      manifest: first.manifest,
      generatedAt: "2099-01-01T00:00:00.000Z",
    });
    expect(second.contentDigest).toBe(first.contentDigest);
    expect(second.releaseKey).toBe(first.releaseKey);
    expect(second.schemaVersion).toBe(ABILITY_CATALOG_RELEASE_SCHEMA_V1);

    const content = buildReleaseContent({
      gameVersion: first.gameVersion,
      wowBuild: first.wowBuild,
      seasonSlug: first.seasonSlug,
      previousReleaseId: first.previousReleaseId,
      topology: first.topology,
      rules: first.rules,
      manifest: first.manifest,
    });
    expect(contentDigestOf(content)).toBe(first.contentDigest);
  });

  it("applies TOMBSTONE_RULE via validToBuild + deprecated certainty", () => {
    const rules = getAllRegisteredRules().slice(0, 2);
    const key = rules[0]!.canonicalKey;
    const artifact = compileFixture({
      rules,
      changes: [{ op: "TOMBSTONE_RULE", canonicalKey: key, validToBuild: "70000" }],
    });
    const tombstoned = artifact.rules.find((r) => r.canonicalKey === key);
    expect(tombstoned?.validToBuild).toBe("70000");
    expect(tombstoned?.provenance.certainty).toBe("deprecated");
  });
});
