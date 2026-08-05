/**
 * Provider-free terminal-state tracer for a single report code through discovery.
 * Never infers "run does not exist" merely because it was not persisted.
 */
import type {
  HydrationCoverageDiagnostics,
  OmittedHydrationReport,
} from "./report-hydration.js";

export type ReportDiscoveryTerminalState =
  | "REPORT_NOT_LISTED"
  | "REPORT_LISTED_NOT_HYDRATED"
  | "REPORT_EXCLUDED_BY_HYDRATION_CAP"
  | "FIGHT_NOT_FOUND"
  | "DUNGEON_MAPPING_FAILED"
  | "CHARACTER_NOT_FOUND_IN_REPORT"
  | "SPEC_IDENTITY_MISMATCH"
  | "CANDIDATE_INELIGIBLE"
  | "DUPLICATE_SOURCE_FIGHT"
  | "VALID_CANDIDATE_NOT_SELECTED"
  | "VALID_CANDIDATE_SELECTED";

export interface ReportDiscoveryTraceInput {
  reportCode: string;
  /** All report codes from recentReports pagination (listed). */
  listedReportCodes: readonly string[];
  /** Report codes for which fetchReport was invoked. */
  hydratedReportCodes: readonly string[];
  hydrationDiagnostics?: Pick<
    HydrationCoverageDiagnostics,
    "omittedReports" | "stopReason" | "reportFetchAttempts"
  > | null;
  /** Fight identities produced for this report after hydration. */
  fightsFromReport?: ReadonlyArray<{
    fightId: number;
    dungeonSlug: string | null;
    actorResolved: boolean;
    specMatched: boolean | null;
    eligible: boolean;
    rejectionReason?: string | null;
  }>;
  /** Selected manifest identities (reportCode:fightId). */
  selectedIdentities?: readonly string[];
  /** Eligible but unselected candidate identities. */
  eligibleUnselectedIdentities?: readonly string[];
}

export interface ReportDiscoveryTraceResult {
  reportCode: string;
  terminalState: ReportDiscoveryTerminalState;
  listed: boolean;
  hydrated: boolean;
  omission: OmittedHydrationReport | null;
  notes: string[];
  providerCalls: 0;
}

export function traceReportThroughDiscovery(
  input: ReportDiscoveryTraceInput,
): ReportDiscoveryTraceResult {
  const code = input.reportCode.trim();
  const listedSet = new Set(input.listedReportCodes);
  const hydratedSet = new Set(input.hydratedReportCodes);
  const listed = listedSet.has(code);
  const hydrated = hydratedSet.has(code);
  const omission =
    input.hydrationDiagnostics?.omittedReports.find((o) => o.reportCode === code) ?? null;
  const notes: string[] = [];

  if (!listed) {
    return {
      reportCode: code,
      terminalState: "REPORT_NOT_LISTED",
      listed: false,
      hydrated: false,
      omission,
      notes: ["Report code absent from recentReports listing / pagination set"],
      providerCalls: 0,
    };
  }

  if (!hydrated) {
    const cap =
      omission?.reason === "REPORT_EXCLUDED_BY_HYDRATION_CAP" ||
      input.hydrationDiagnostics?.stopReason === "budget_exhausted" ||
      input.hydrationDiagnostics?.stopReason === "legacy_fixed_budget";
    return {
      reportCode: code,
      terminalState: cap
        ? "REPORT_EXCLUDED_BY_HYDRATION_CAP"
        : "REPORT_LISTED_NOT_HYDRATED",
      listed: true,
      hydrated: false,
      omission,
      notes: [
        cap
          ? "Listed but never fetched — hydration budget exhausted on other reports"
          : "Listed but not hydrated (stop before budget or deferred)",
      ],
      providerCalls: 0,
    };
  }

  const fights = input.fightsFromReport ?? [];
  if (fights.length === 0) {
    return {
      reportCode: code,
      terminalState: "FIGHT_NOT_FOUND",
      listed: true,
      hydrated: true,
      omission: null,
      notes: ["Hydrated but no Mythic+ fights extracted for character"],
      providerCalls: 0,
    };
  }

  if (fights.every((f) => !f.actorResolved)) {
    return {
      reportCode: code,
      terminalState: "CHARACTER_NOT_FOUND_IN_REPORT",
      listed: true,
      hydrated: true,
      omission: null,
      notes: ["No fight ownership matched character actor"],
      providerCalls: 0,
    };
  }

  if (fights.every((f) => f.specMatched === false)) {
    return {
      reportCode: code,
      terminalState: "SPEC_IDENTITY_MISMATCH",
      listed: true,
      hydrated: true,
      omission: null,
      notes: ["Actor present but specialization did not match scope"],
      providerCalls: 0,
    };
  }

  if (fights.every((f) => f.dungeonSlug == null)) {
    return {
      reportCode: code,
      terminalState: "DUNGEON_MAPPING_FAILED",
      listed: true,
      hydrated: true,
      omission: null,
      notes: ["Fights present but encounter→dungeon mapping failed"],
      providerCalls: 0,
    };
  }

  const eligible = fights.filter((f) => f.eligible && f.dungeonSlug != null);
  if (eligible.length === 0) {
    notes.push(
      ...fights
        .map((f) => f.rejectionReason)
        .filter((r): r is string => Boolean(r)),
    );
    return {
      reportCode: code,
      terminalState: "CANDIDATE_INELIGIBLE",
      listed: true,
      hydrated: true,
      omission: null,
      notes: notes.length > 0 ? notes : ["Hydrated fights failed eligibility"],
      providerCalls: 0,
    };
  }

  const selected = new Set(input.selectedIdentities ?? []);
  const unselected = new Set(input.eligibleUnselectedIdentities ?? []);
  const selectedFromReport = eligible.filter((f) =>
    selected.has(`${code}:${f.fightId}`),
  );
  if (selectedFromReport.length > 0) {
    return {
      reportCode: code,
      terminalState: "VALID_CANDIDATE_SELECTED",
      listed: true,
      hydrated: true,
      omission: null,
      notes: [`Selected ${selectedFromReport.length} fight(s) from report`],
      providerCalls: 0,
    };
  }

  const duplicateOnly = eligible.every((f) =>
    (f.rejectionReason ?? "").includes("DUPLICATE"),
  );
  if (duplicateOnly) {
    return {
      reportCode: code,
      terminalState: "DUPLICATE_SOURCE_FIGHT",
      listed: true,
      hydrated: true,
      omission: null,
      notes: ["Eligible fights rejected as duplicate source identities"],
      providerCalls: 0,
    };
  }

  if (eligible.some((f) => unselected.has(`${code}:${f.fightId}`))) {
    return {
      reportCode: code,
      terminalState: "VALID_CANDIDATE_NOT_SELECTED",
      listed: true,
      hydrated: true,
      omission: null,
      notes: ["Valid eligible candidate present but not selected into a slot"],
      providerCalls: 0,
    };
  }

  return {
    reportCode: code,
    terminalState: "VALID_CANDIDATE_NOT_SELECTED",
    listed: true,
    hydrated: true,
    omission: null,
    notes: ["Hydrated eligible fights did not land in selected slots"],
    providerCalls: 0,
  };
}
