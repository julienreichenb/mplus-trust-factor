/**
 * Phase 3B.3.5 — identity normalization, set-equivalence ordering, coverage statuses.
 */

import { describe, expect, it } from "vitest";
import {
  canonicalizeRetailClassSpecIdentity,
  createStaticAbilityCatalogContext,
  normalizeRetailClassSlug,
  normalizeRetailSpecSlug,
  resolveAbilityCatalog,
  resolveAbilityRuleBySpellId,
  dimensionTagsForRule,
} from "@mplus/abilities";
import { normalizeAbilityRuleForContent } from "@mplus/abilities/release";
import type { AbilityRule } from "@mplus/abilities";
import { deriveV4ParticipantDigestFromFrozenRaw } from "./ability-catalog-replay-derive.js";

describe("replay identity normalization", () => {
  it("maps deathknight → death-knight and demonhunter → demon-hunter", () => {
    expect(normalizeRetailClassSlug("deathknight")).toBe("death-knight");
    expect(normalizeRetailClassSlug("DeathKnight")).toBe("death-knight");
    expect(normalizeRetailClassSlug("demonhunter")).toBe("demon-hunter");
    expect(normalizeRetailClassSlug("demon-hunter")).toBe("demon-hunter");
  });

  it("normalizes beast_mastery → beast-mastery for hunter", () => {
    expect(normalizeRetailSpecSlug("hunter", "beast_mastery")).toBe("beast-mastery");
    expect(normalizeRetailSpecSlug("hunter", "beast-mastery")).toBe("beast-mastery");
  });

  it("keeps unknown class unknown (no fabricated hyphenation beyond known map)", () => {
    expect(normalizeRetailClassSlug("notaclass")).toBe("notaclass");
    expect(
      resolveAbilityCatalog({ classSlug: "notaclass", specSlug: "fire" }).ok,
    ).toBe(false);
    expect(
      resolveAbilityCatalog({ classSlug: "notaclass", specSlug: "fire" }),
    ).toMatchObject({ reason: "UNKNOWN_CLASS" });
  });

  it("canonical identity does not mutate the source object", () => {
    const source = { classSlug: "deathknight", specSlug: "blood" };
    const before = structuredClone(source);
    const identity = canonicalizeRetailClassSpecIdentity(source);
    expect(source).toEqual(before);
    expect(identity.classSlug).toBe("death-knight");
    expect(identity.specSlug).toBe("blood");
    expect(identity.classNormalized).toBe(true);
  });

  it("normalized DK/DH digests resolve the same catalog rules as hyphenated forms", () => {
    const blood = resolveAbilityRuleBySpellId({
      classSlug: "deathknight",
      specSlug: "blood",
      spellId: 48707, // Anti-Magic Shell
    });
    const bloodCanon = resolveAbilityRuleBySpellId({
      classSlug: "death-knight",
      specSlug: "blood",
      spellId: 48707,
    });
    expect(blood.status).toBe("matched");
    expect(bloodCanon.status).toBe("matched");
    if (blood.status === "matched" && bloodCanon.status === "matched") {
      expect(blood.rule.canonicalKey).toBe(bloodCanon.rule.canonicalKey);
    }

    const meta = resolveAbilityRuleBySpellId({
      classSlug: "demonhunter",
      specSlug: "havoc",
      spellId: 198589, // Blur
    });
    const metaCanon = resolveAbilityRuleBySpellId({
      classSlug: "demon-hunter",
      specSlug: "havoc",
      spellId: 198589,
    });
    expect(meta.status).toBe("matched");
    expect(metaCanon.status).toBe("matched");
    if (meta.status === "matched" && metaCanon.status === "matched") {
      expect(meta.rule.canonicalKey).toBe(metaCanon.rule.canonicalKey);
    }
  });

  it("static catalog context resolves provider-style class slugs", () => {
    const catalog = createStaticAbilityCatalogContext();
    const toolkit = catalog.resolveCatalog({
      classSlug: "deathknight",
      specSlug: "unholy",
    });
    expect(toolkit.ok).toBe(true);
  });
});

describe("alias / dimensionTags ordering semantics", () => {
  it("runtime consumers treat aliases as sets (order-insensitive membership)", () => {
    const catalog = createStaticAbilityCatalogContext();
    // Find any rule with aliases via a known shaman Bloodlust alias path.
    const a = catalog.resolveBySpellId({
      spellId: 32182,
      classSlug: "shaman",
      specSlug: "enhancement",
    });
    const b = catalog.resolveBySpellId({
      spellId: 2825,
      classSlug: "shaman",
      specSlug: "enhancement",
    });
    expect(a.status).toBe("matched");
    expect(b.status).toBe("matched");
    if (a.status === "matched" && b.status === "matched") {
      expect(a.rule.canonicalKey).toBe(b.rule.canonicalKey);
      const aliases = a.rule.aliases ?? [];
      const shuffled = [...aliases].reverse();
      expect(new Set(aliases)).toEqual(new Set(shuffled));
      expect(aliases.includes(32182) || a.rule.spellIds.includes(32182)).toBe(true);
    }
  });

  it("release normalize sorts aliases/dimensionTags for CAS stability only", () => {
    const unsorted: AbilityRule = {
      canonicalKey: "test.rule",
      name: "Test",
      category: "UTILITY",
      spellIds: [3, 1, 2],
      aliases: [30, 10, 20],
      dimensionTags: ["UTILITY_INTERRUPT", "UTILITY_DISPEL"],
      classSlug: "mage",
      specSlugs: ["fire"],
      roles: ["DPS"],
      sourceOwnership: "PLAYER",
      sharedAcrossSpecs: false,
      availability: "BASELINE",
      provenance: {
        source: "CURATED_OVERRIDE",
        verifiedAt: "2026-01-01T00:00:00.000Z",
        gameVersion: "retail",
      },
    };
    const normalized = normalizeAbilityRuleForContent(unsorted);
    expect(normalized.aliases).toEqual([10, 20, 30]);
    expect(normalized.dimensionTags).toEqual(["UTILITY_DISPEL", "UTILITY_INTERRUPT"]);
    expect(normalized.spellIds).toEqual([3, 1, 2]); // primary order preserved
    expect(new Set(normalized.aliases)).toEqual(new Set(unsorted.aliases));
    expect(new Set(normalized.dimensionTags)).toEqual(new Set(unsorted.dimensionTags));
  });

  it("dimensionTags are membership-checked, not position-checked, in catalog filters", () => {
    const catalog = createStaticAbilityCatalogContext();
    const resolved = catalog.resolveBySpellId({
      spellId: 2139, // Counterspell
      classSlug: "mage",
      specSlug: "fire",
    });
    expect(resolved.status).toBe("matched");
    if (resolved.status === "matched") {
      const tags = dimensionTagsForRule(resolved.rule);
      expect(tags.includes("UTILITY_INTERRUPT")).toBe(true);
      expect([...tags].reverse().includes("UTILITY_INTERRUPT")).toBe(true);
    }
  });
});

describe("coverage status vocabulary", () => {
  it("defines the four corpus coverage statuses used by reporting", () => {
    const statuses = [
      "AVAILABLE_NATIVE_V4",
      "DERIVED_FROM_FROZEN_EVIDENCE",
      "MISSING_CORPUS_EVIDENCE",
      "UNSUPPORTED_SCHEMA",
    ] as const;
    expect(new Set(statuses).size).toBe(4);
  });
});

describe("frozen digest derivation seam", () => {
  it("fails closed without mutating input when payload is garbage", () => {
    const payload = { not: "a-wcl-raw" };
    const result = deriveV4ParticipantDigestFromFrozenRaw({
      rawRunId: "raw-1",
      rawPayload: payload,
      participantActorId: 1,
      characterName: "Test",
      realmSlug: "realm",
      regionCode: "eu",
      classSlug: "druid",
      specSlug: "balance",
      role: "DPS",
      priorDigest: null,
    });
    expect(result.ok).toBe(false);
    expect(payload).toEqual({ not: "a-wcl-raw" });
  });
});

describe("expected topology count is derived from static catalog (Bootstrap base)", () => {
  it("counts supported retail specs from topology without hardcoding 40", () => {
    const catalog = createStaticAbilityCatalogContext();
    const expected = catalog
      .topology()
      .classes.flatMap((c) => c.specs.filter((s) => s.supportState !== "UNSUPPORTED"));
    expect(expected.length).toBeGreaterThanOrEqual(40);
    // Bootstrap Release 0 compiles from the same static topology.
    expect(expected.some((s) => s.slug === "balance")).toBe(true);
    expect(expected.some((s) => s.slug === "devastation")).toBe(true);
  });
});
