/**
 * Pure helpers for bounded recentReports pagination (provider-free tests).
 */
import {
  MAX_DISCOVERY_CANDIDATES,
  MAX_RECENT_REPORT_PAGES,
  MAX_RECENT_REPORTS_LIMIT,
} from "./bounds.js";

export type RecentReportsPageFetchResult = {
  reportCodes: string[];
  hasMorePages: boolean;
  privateSkipped: number;
  unlistedSkipped: number;
};

export type BoundedRecentReportsPaginationResult = {
  reportCodes: string[];
  pagesFetched: number;
  privateSkipped: number;
  unlistedSkipped: number;
  stopReason: "has_more_false" | "bounds_satisfied" | "page_cap";
};

/**
 * Fetch recentReports pages until has_more_pages is false, unique-report
 * bounds are satisfied, or MAX_RECENT_REPORT_PAGES is reached.
 * Deduplicates report codes across pages.
 */
export async function collectBoundedRecentReportCodes(input: {
  fetchPage: (page: number, limit: number) => Promise<RecentReportsPageFetchResult>;
  maxPages?: number;
  pageLimit?: number;
  maxUniqueReports?: number;
}): Promise<BoundedRecentReportsPaginationResult> {
  const maxPages = input.maxPages ?? MAX_RECENT_REPORT_PAGES;
  const pageLimit = input.pageLimit ?? MAX_RECENT_REPORTS_LIMIT;
  const maxUnique = input.maxUniqueReports ?? MAX_DISCOVERY_CANDIDATES;

  const seen = new Set<string>();
  const reportCodes: string[] = [];
  let privateSkipped = 0;
  let unlistedSkipped = 0;
  let pagesFetched = 0;
  let stopReason: BoundedRecentReportsPaginationResult["stopReason"] = "page_cap";

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await input.fetchPage(page, pageLimit);
    pagesFetched = page;
    privateSkipped += result.privateSkipped;
    unlistedSkipped += result.unlistedSkipped;
    for (const code of result.reportCodes) {
      if (seen.has(code)) continue;
      seen.add(code);
      reportCodes.push(code);
    }
    if (reportCodes.length >= maxUnique) {
      reportCodes.length = maxUnique;
      stopReason = "bounds_satisfied";
      break;
    }
    if (!result.hasMorePages) {
      stopReason = "has_more_false";
      break;
    }
    if (page === maxPages) {
      stopReason = "page_cap";
    }
  }

  return {
    reportCodes,
    pagesFetched,
    privateSkipped,
    unlistedSkipped,
    stopReason,
  };
}
