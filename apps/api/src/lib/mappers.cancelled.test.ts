import { describe, expect, it } from "vitest";
import type { IngestionJob } from "@mplus/database";
import { mapJobStatus } from "./mappers.js";

describe("mapJobStatus CANCELLED", () => {
  it("maps CANCELLED as cancelled and never exposes cancel reason publicly", () => {
    const job = {
      id: "job-1",
      jobType: "refresh-character",
      status: "CANCELLED",
      dedupeKey: "d1",
      scheduledAt: new Date("2026-07-01T00:00:00.000Z"),
      startedAt: new Date("2026-07-01T00:01:00.000Z"),
      completedAt: new Date("2026-07-01T00:02:00.000Z"),
      error: { code: "CANCELLED", message: "admin_kill_all: cooperative cancel" },
      cancelReason: "admin_kill_all",
    } as unknown as IngestionJob;

    const dto = mapJobStatus(job);
    expect(dto.status).toBe("cancelled");
    expect(dto.errorMessage).toBeNull();
    expect(JSON.stringify(dto)).not.toMatch(/admin_kill_all|cooperative/i);
  });
});
