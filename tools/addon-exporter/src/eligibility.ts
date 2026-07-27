import type { AddonExportEligibilityConfig, AddonExportInput } from "./types.js";

export function isEligibleForExport(
  record: AddonExportInput,
  config: AddonExportEligibilityConfig,
): boolean {
  if (record.searchedOnly && !config.includeSearchedIneligible) {
    return false;
  }
  if (config.excludeStale && record.stale) {
    return false;
  }
  if (record.runCount < config.minRunCount) {
    return false;
  }
  if (record.confidence < config.minConfidence) {
    return false;
  }
  if (config.requireBaselineOrTop25 && !record.baselineDungeonComplete && !record.top25Percent) {
    return false;
  }
  return true;
}

export function filterEligible(
  records: AddonExportInput[],
  config: AddonExportEligibilityConfig,
): AddonExportInput[] {
  return records.filter((record) => isEligibleForExport(record, config));
}
