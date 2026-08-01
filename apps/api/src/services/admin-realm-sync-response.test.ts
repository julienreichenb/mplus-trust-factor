import { describe, expect, it } from "vitest";
import { ADMIN_REALM_SYNC_RESULT_FIELDS } from "@mplus/contracts";
import {
  toAdminRealmSyncResponse,
  toAdminRealmSyncResult,
  twStyleRealmSyncResultFixture,
} from "./admin-realm-sync-response.js";
import {
  adminRealmSyncResultSchema,
} from "../routes/schemas.js";

describe("admin realm sync response mapping", () => {
  it("maps TW-style internal result with indexEntries (not indexed)", () => {
    const internal = twStyleRealmSyncResultFixture();
    const dto = toAdminRealmSyncResult(internal);

    expect(dto.indexEntries).toBe(11);
    expect(dto).not.toHaveProperty("indexed");
    expect(dto.rejectedAtIndex).toBe(2);
    expect(dto.detailCandidates).toBe(9);
    expect(dto.detailsFetched).toBe(9);
    expect(dto.eligible).toBe(8);
    expect(dto.rejectedTournament).toBe(1);
    expect(dto.rejectedInternal).toBe(1);
    expect(dto.detailFailures).toBe(1);
    expect(dto.retainedLastKnownGood).toBe(1);
    expect(dto.newlyDeactivated).toBe(0);
    expect(dto.activeCatalogCount).toBe(8);
    expect(dto.rejectedSamples).toEqual([
      "Arena (TOURNAMENT)",
      "Internal Test (INTERNAL_OTHER)",
    ]);
  });

  it("includes every required DTO field and matches schema property names", () => {
    const dto = toAdminRealmSyncResult(twStyleRealmSyncResultFixture());
    for (const field of ADMIN_REALM_SYNC_RESULT_FIELDS) {
      expect(dto).toHaveProperty(field);
      expect(adminRealmSyncResultSchema.properties).toHaveProperty(field);
      expect(adminRealmSyncResultSchema.required).toContain(field);
    }
    expect(Object.keys(adminRealmSyncResultSchema.properties).sort()).toEqual(
      [...ADMIN_REALM_SYNC_RESULT_FIELDS].sort(),
    );
    expect(adminRealmSyncResultSchema.required).not.toContain("indexed");
    expect(adminRealmSyncResultSchema.properties).not.toHaveProperty("indexed");
  });

  it("TW-style envelope satisfies every required schema field for Fastify serialization", () => {
    const response = toAdminRealmSyncResponse([twStyleRealmSyncResultFixture()]);
    expect(response.ok).toBe(true);
    expect(response.results).toHaveLength(1);

    const row = response.results[0]!;
    const required = adminRealmSyncResultSchema.required;
    for (const field of required) {
      expect(row).toHaveProperty(field);
      expect(row[field as keyof typeof row]).not.toBeUndefined();
    }

    // Simulate Fastify response serialization allow-list (additionalProperties: false).
    const serializedRow: Record<string, unknown> = {};
    for (const key of Object.keys(adminRealmSyncResultSchema.properties)) {
      serializedRow[key] = row[key as keyof typeof row];
    }
    for (const field of required) {
      expect(serializedRow).toHaveProperty(field);
      expect(serializedRow[field]).not.toBeUndefined();
    }
    expect(serializedRow).not.toHaveProperty("indexed");
    expect(serializedRow.indexEntries).toBe(11);
    expect(JSON.parse(JSON.stringify({ ok: true, results: [serializedRow] }))).toMatchObject({
      ok: true,
      results: [{ region: "TW", indexEntries: 11, eligible: 8, activeCatalogCount: 8 }],
    });
  });

  it("copies arrays so callers cannot mutate the internal result via the DTO", () => {
    const internal = twStyleRealmSyncResultFixture();
    const dto = toAdminRealmSyncResult(internal);
    dto.errors.push("mutated");
    dto.rejectedSamples.push("mutated");
    expect(internal.errors).toEqual([]);
    expect(internal.rejectedSamples).toHaveLength(2);
  });
});
