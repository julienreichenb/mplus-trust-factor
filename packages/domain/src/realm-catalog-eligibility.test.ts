import { describe, expect, it } from "vitest";
import {
  classifyRealmCatalogEntry,
  classifyRealmIndexEntry,
} from "./realm-catalog-eligibility.js";

describe("classifyRealmIndexEntry", () => {
  it.each([
    ["EU1A Account Realm", "eu1a-account-realm"],
    ["US5A Account Realm", "us5a-account-realm"],
    ["KR1A Account Realm", "kr1a-account-realm"],
  ])("rejects account realm %s", (name, slug) => {
    expect(classifyRealmIndexEntry({ name, slug })).toEqual({
      eligible: false,
      reason: "INTERNAL_ACCOUNT_REALM",
    });
  });

  it.each([
    ["EU1A1-INST", "eu1a1inst"],
    ["EU1A2-INST", "eu1a2inst"],
    ["EU2A2-INST", "eu2a2inst"],
    ["EU7A1-INST-BFA", "eu7a1inst-bfa"],
    ["US1A2-INST", "us1a2inst"],
    ["KR1A1-INST", "kr1a1inst"],
  ])("rejects instance realm %s", (name, slug) => {
    expect(classifyRealmIndexEntry({ name, slug })).toEqual({
      eligible: false,
      reason: "INTERNAL_INSTANCE_REALM",
    });
  });

  it.each([
    ["EU7A-BG-RU", "eu7abgru"],
    ["EU Arena Pass CSBG", "eu-arena-pass-csbg"],
    ["US Auxiliary 70", "us-auxiliary-70"],
    ["GMSupport TW2-01", "gmsupport-tw201"],
  ])("rejects service realm %s", (name, slug) => {
    expect(classifyRealmIndexEntry({ name, slug })).toEqual({
      eligible: false,
      reason: "INTERNAL_SERVICE_REALM",
    });
  });

  it.each([
    ["Argent Dawn", "argent-dawn"],
    ["Kazzak", "kazzak"],
    ["Silvermoon", "silvermoon"],
    ["Tarren Mill", "tarren-mill"],
    ["Twisting Nether", "twisting-nether"],
    ["La Croisade écarlate", "la-croisade-ecarlate"],
    ["Gul'dan", "guldan"],
    ["Chillwind Point", "chillwind-point"],
    ["Azshara", "azshara"],
    ["아즈샤라", "azshara-kr"],
    ["阿薩斯", "arthas"],
    ["Quel'Thalas", "quelthalas"],
  ])("keeps legitimate realm %s", (name, slug) => {
    expect(classifyRealmIndexEntry({ name, slug })).toEqual({ eligible: true });
  });
});

describe("classifyRealmCatalogEntry", () => {
  const base = {
    name: "Tarren Mill",
    slug: "tarren-mill",
    blizzardRealmId: 1084,
    region: "EU",
    connectedRealmId: 1084,
    isTournament: false,
  };

  it("accepts a complete legitimate detail", () => {
    expect(classifyRealmCatalogEntry(base)).toEqual({ eligible: true });
  });

  it("rejects isTournament even when the name looks normal", () => {
    expect(classifyRealmCatalogEntry({ ...base, isTournament: true })).toEqual({
      eligible: false,
      reason: "TOURNAMENT",
    });
  });

  it("rejects missing connected realm when required", () => {
    expect(classifyRealmCatalogEntry({ ...base, connectedRealmId: null })).toEqual({
      eligible: false,
      reason: "MISSING_REQUIRED_DETAIL",
    });
  });

  it("rejects incomplete ids", () => {
    expect(classifyRealmCatalogEntry({ ...base, blizzardRealmId: 0 })).toEqual({
      eligible: false,
      reason: "MISSING_REQUIRED_DETAIL",
    });
  });
});
