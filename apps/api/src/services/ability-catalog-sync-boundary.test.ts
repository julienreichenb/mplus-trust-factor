import { describe, expect, it } from "vitest";
import {
  assertApiCatalogSimcRefreshAllowed,
  isApiCatalogSimcRefreshAllowed,
} from "./ability-catalog-sync-boundary.js";

describe("ability catalog sync API boundary", () => {
  it("allows SimC refresh only in development and test", () => {
    expect(isApiCatalogSimcRefreshAllowed("development")).toBe(true);
    expect(isApiCatalogSimcRefreshAllowed("test")).toBe(true);
    expect(isApiCatalogSimcRefreshAllowed("staging")).toBe(false);
    expect(isApiCatalogSimcRefreshAllowed("production")).toBe(false);
  });

  it("fails closed for production and staging", () => {
    expect(() => assertApiCatalogSimcRefreshAllowed("production")).toThrow(
      /catalog-sync one-shot container/i,
    );
    expect(() => assertApiCatalogSimcRefreshAllowed("staging")).toThrow(
      /CATALOG_SYNC_NOT_VIA_API|catalog-sync/i,
    );
    expect(() => assertApiCatalogSimcRefreshAllowed("development")).not.toThrow();
  });
});
