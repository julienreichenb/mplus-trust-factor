import { describe, expect, it } from "vitest";
import {
  CURRENT_CATALOG_VERSION_ID,
  createRulesAbilityCatalogContext,
  createStaticAbilityCatalogContext,
  getAllRegisteredRules,
  resolveAbilityRuleBySpellId,
  RETAIL_ABILITY_CATALOG,
} from "./index.js";
import { compileBootstrapRelease0 } from "./release/bootstrap.js";
import { createReleaseAbilityCatalogContext } from "./release/release-catalog-context.js";

describe("AbilityCatalogContext", () => {
  it("static context matches registry defaults", () => {
    const ctx = createStaticAbilityCatalogContext();
    expect(ctx.identity).toEqual({
      kind: "static",
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
    });
    expect(ctx.allRules()).toHaveLength(getAllRegisteredRules().length);
    const spellId = RETAIL_ABILITY_CATALOG.rules[0]!.spellIds[0]!;
    const viaCtx = ctx.resolveBySpellId({ spellId });
    const viaRegistry = resolveAbilityRuleBySpellId({ spellId });
    expect(viaCtx).toEqual(viaRegistry);
  });

  it("release bootstrap context matches static spell resolution for shared pool", () => {
    const bootstrap = compileBootstrapRelease0();
    const releaseCtx = createReleaseAbilityCatalogContext({
      artifact: bootstrap.artifact,
    });
    const staticCtx = createStaticAbilityCatalogContext();
    expect(releaseCtx.allRules()).toHaveLength(staticCtx.allRules().length);

    const sample = staticCtx.allRules().slice(0, 40);
    for (const rule of sample) {
      const id = rule.spellIds[0]!;
      const a = staticCtx.resolveBySpellId({
        spellId: id,
        classSlug: rule.classSlug,
        specSlug: rule.specSlugs[0] ?? null,
      });
      const b = releaseCtx.resolveBySpellId({
        spellId: id,
        classSlug: rule.classSlug,
        specSlug: rule.specSlugs[0] ?? null,
      });
      expect(b.status).toBe(a.status);
      if (a.status === "matched" && b.status === "matched") {
        expect(b.rule.canonicalKey).toBe(a.rule.canonicalKey);
      }
    }
  });

  it("does not change RETAIL_ABILITY_CATALOG authority", () => {
    createStaticAbilityCatalogContext();
    createRulesAbilityCatalogContext({
      identity: { kind: "static", catalogVersion: "test" },
      rules: [],
      topology: { classes: [], races: [] },
    });
    expect(RETAIL_ABILITY_CATALOG.catalogVersion).toBe(CURRENT_CATALOG_VERSION_ID);
    expect(RETAIL_ABILITY_CATALOG.rules).toHaveLength(311);
  });

  it("unknown spell remains unmatched under both contexts", () => {
    const staticCtx = createStaticAbilityCatalogContext();
    const bootstrap = compileBootstrapRelease0();
    const releaseCtx = createReleaseAbilityCatalogContext({
      artifact: bootstrap.artifact,
    });
    const id = 9_999_999_001;
    expect(staticCtx.resolveBySpellId({ spellId: id }).status).toBe("unmatched");
    expect(releaseCtx.resolveBySpellId({ spellId: id }).status).toBe("unmatched");
  });
});
