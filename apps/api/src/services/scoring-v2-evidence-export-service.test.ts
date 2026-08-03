import { describe, expect, it } from "vitest";
import {
  buildUnifiedHistoryItems,
  paginateUnifiedHistory,
  type HistoryExportRow,
} from "./scoring-v2-evidence-export-service.js";

function row(
  id: string,
  createdAt: string,
  frozen: boolean,
  frozenAt?: string,
): HistoryExportRow {
  return {
    id,
    cohortId: "11111111-1111-4111-8111-111111111111",
    cohortRevision: 1,
    status: "COMPLETED",
    requestedByUserId: "22222222-2222-4222-8222-222222222222",
    createdAt: new Date(createdAt),
    completedAt: new Date(createdAt),
    frozenAt: frozen && frozenAt ? new Date(frozenAt) : frozen ? new Date(createdAt) : null,
    blockerCount: 0,
    warningCount: 0,
    archiveContentHash: `archive-${id}`,
    frozenBundleContentHash: frozen ? `bundle-${id}` : null,
    cohort: { name: "Cohort" },
  };
}

describe("listHistory pagination (M1)", () => {
  it("builds one history item per export and an extra frozen_bundle when frozen", () => {
    const items = buildUnifiedHistoryItems([
      row("a", "2026-08-03T12:00:00.000Z", true, "2026-08-03T13:00:00.000Z"),
      row("b", "2026-08-03T11:00:00.000Z", false),
    ]);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.kind)).toEqual([
      "evidence_export",
      "frozen_bundle",
      "evidence_export",
    ]);
    expect(items[0]!.id).toBe("a");
    expect(items[1]!.id).toBe("a:bundle");
    expect(items[1]!.rootHash).toBe("bundle-a");
    expect(items[2]!.id).toBe("b");
  });

  it("paginates unified items so page length ≤ pageSize and total matches unified count", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row(
        `e${i}`,
        `2026-08-03T${String(12 - i).padStart(2, "0")}:00:00.000Z`,
        true,
      ),
    );
    // 5 exports × 2 = 10 unified items
    const unified = buildUnifiedHistoryItems(rows);
    expect(unified).toHaveLength(10);

    const page1 = paginateUnifiedHistory(unified, 1, 3, unified.length);
    expect(page1.items).toHaveLength(3);
    expect(page1.total).toBe(10);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(3);
    expect(page1.items.every((i) => i.id.startsWith("e0") || i.id === "e0:bundle" || i.id === "e1")).toBe(
      true,
    );

    const page2 = paginateUnifiedHistory(unified, 2, 3, unified.length);
    expect(page2.items).toHaveLength(3);
    expect(page2.page).toBe(2);
    // No overlap with page 1
    const page1Ids = new Set(page1.items.map((i) => i.id));
    for (const item of page2.items) {
      expect(page1Ids.has(item.id)).toBe(false);
    }

    const page4 = paginateUnifiedHistory(unified, 4, 3, unified.length);
    expect(page4.items).toHaveLength(1);
    expect(page4.items.length).toBeLessThanOrEqual(page4.pageSize);
  });

  it("clamps pageSize to 50 and uses stable export→freeze pairing order", () => {
    const unified = buildUnifiedHistoryItems([
      row("z", "2026-08-03T12:00:00.000Z", true),
      row("y", "2026-08-03T11:00:00.000Z", true),
    ]);
    const page = paginateUnifiedHistory(unified, 1, 999, unified.length);
    expect(page.pageSize).toBe(50);
    expect(page.items.map((i) => i.id)).toEqual(["z", "z:bundle", "y", "y:bundle"]);
  });
});
