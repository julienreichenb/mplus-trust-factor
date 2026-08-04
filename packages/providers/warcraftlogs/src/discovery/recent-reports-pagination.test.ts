import { describe, expect, it, vi } from "vitest";
import { collectBoundedRecentReportCodes } from "./recent-reports-pagination.js";

describe("collectBoundedRecentReportCodes", () => {
  it("requests later pages when needed and stops on has_more_pages=false", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 1) {
        return {
          reportCodes: ["a", "b"],
          hasMorePages: true,
          privateSkipped: 0,
          unlistedSkipped: 0,
        };
      }
      return {
        reportCodes: ["c"],
        hasMorePages: false,
        privateSkipped: 1,
        unlistedSkipped: 0,
      };
    });

    const result = await collectBoundedRecentReportCodes({ fetchPage, maxPages: 5 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.reportCodes).toEqual(["a", "b", "c"]);
    expect(result.stopReason).toBe("has_more_false");
    expect(result.privateSkipped).toBe(1);
  });

  it("stops when unique-report bounds are satisfied", async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      reportCodes: [`r${page}-1`, `r${page}-2`],
      hasMorePages: true,
      privateSkipped: 0,
      unlistedSkipped: 0,
    }));

    const result = await collectBoundedRecentReportCodes({
      fetchPage,
      maxPages: 10,
      maxUniqueReports: 3,
    });
    expect(result.reportCodes).toHaveLength(3);
    expect(result.stopReason).toBe("bounds_satisfied");
    expect(result.pagesFetched).toBeLessThanOrEqual(2);
  });

  it("deduplicates report codes across pages", async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      reportCodes: page === 1 ? ["dup", "a"] : ["dup", "b"],
      hasMorePages: page === 1,
      privateSkipped: 0,
      unlistedSkipped: 0,
    }));

    const result = await collectBoundedRecentReportCodes({ fetchPage, maxPages: 5 });
    expect(result.reportCodes).toEqual(["dup", "a", "b"]);
  });

  it("stops at the configured page safety cap", async () => {
    const fetchPage = vi.fn(async () => ({
      reportCodes: ["x"],
      hasMorePages: true,
      privateSkipped: 0,
      unlistedSkipped: 0,
    }));

    const result = await collectBoundedRecentReportCodes({
      fetchPage,
      maxPages: 2,
      maxUniqueReports: 100,
    });
    expect(result.pagesFetched).toBe(2);
    expect(result.stopReason).toBe("page_cap");
  });
});
