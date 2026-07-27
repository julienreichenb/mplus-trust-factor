import { describe, expect, it } from "vitest";
import { LOOKUP_TEST_VECTORS } from "./constants.js";
import { computeDatasetChecksum } from "./checksum.js";
import { filterEligible } from "./eligibility.js";
import { buildExportResult, runExport } from "./export.js";
import { buildLookupKey } from "./identity.js";
import { escapeLuaString, renderCompactRecord } from "./lua.js";
import { redFlagsToBitset } from "./record.js";
import { buildFixtureRecords } from "./synthetic.js";
import type { AddonExportContext } from "./types.js";

const GENERATED_AT = "2026-07-27T09:00:00.000Z";

const context: AddonExportContext = {
  formatVersion: 1,
  generatedAt: GENERATED_AT,
  region: "EU",
  seasonSlug: "season-mvp",
  scoreModelKey: "default",
  scoreModelVersion: 1,
};

describe("identity normalization vectors", () => {
  it("matches shared lookup keys", () => {
    for (const vector of LOOKUP_TEST_VECTORS) {
      expect(buildLookupKey(vector.region, vector.realmSlug, vector.name)).toBe(vector.expectedKey);
    }
  });

  it("normalizes unicode and casing", () => {
    expect(buildLookupKey("eu", "Argent-Dawn", "Testchar")).toBe("EU:argent-dawn:testchar");
  });
});

describe("eligibility filter", () => {
  const records = buildFixtureRecords(GENERATED_AT);

  it("excludes sparse, stale, and search-only profiles by default", () => {
    const eligible = filterEligible(records, {
      minRunCount: 20,
      minConfidence: 0.2,
      requireBaselineOrTop25: true,
      includeSearchedIneligible: false,
      excludeStale: true,
    });
    const names = eligible.map((r) => r.name.toLowerCase());
    expect(names).not.toContain("sparseprofile");
    expect(names).not.toContain("staleplayer");
    expect(names).not.toContain("searchonly");
    expect(names).toContain("aelindra");
  });
});

describe("export determinism", () => {
  it("produces stable checksum for fixture cohort", () => {
    const records = buildFixtureRecords(GENERATED_AT);
    const first = buildExportResult(records, context);
    const second = buildExportResult(records, context);
    expect(first.meta.checksum).toBe(second.meta.checksum);
    expect(first.meta.characterCount).toBeGreaterThan(0);
  });

  it("routes shards by realm and first character", () => {
    const records = buildFixtureRecords(GENERATED_AT);
    const result = buildExportResult(records, context);
    expect(result.shardFiles.some((path) => path.includes("argent-dawn/a"))).toBe(true);
  });
});

describe("red flag bitset", () => {
  it("encodes public flags only", () => {
    expect(redFlagsToBitset(["boost_suspected", "logs_hidden"])).toBe(0b00000101);
  });
});

describe("lua escaping", () => {
  it("escapes quotes and backslashes", () => {
    expect(escapeLuaString('say "hi"\\')).toBe('say \\"hi\\"\\\\');
  });

  it("renders compact tuples without dimensions", () => {
    const rendered = renderCompactRecord({
      score: 87,
      gradeCode: 4,
      confidenceBucket: 3,
      redFlags: 1,
      freshnessDays: 2,
      profileKey: "abc",
    });
    expect(rendered).not.toContain("performance");
    expect(rendered).toContain('"abc"');
  });
});

describe("checksum", () => {
  it("changes when data changes", () => {
    const records = buildFixtureRecords(GENERATED_AT);
    const base = buildExportResult(records, context);
    const mutated = buildExportResult(
      records.map((record, index) =>
        index === 0 ? { ...record, overallScore: record.overallScore + 1 } : record,
      ),
      context,
    );
    expect(mutated.meta.checksum).not.toBe(base.meta.checksum);
  });

  it("matches manual shard hash", () => {
    const records = buildFixtureRecords(GENERATED_AT);
    const result = buildExportResult(records, context);
    expect(result.meta.checksum).toBe(computeDatasetChecksum(result.shards));
  });
});

describe("integration export", () => {
  it("writes addon data without throwing", () => {
    const result = runExport({ generatedAt: GENERATED_AT });
    expect(result.meta.formatVersion).toBe(1);
    expect(result.shardFiles.length).toBeGreaterThan(0);
  });
});
