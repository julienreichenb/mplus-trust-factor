import type { Grade, RegionCode } from "@mplus/contracts";

/** Addon-safe summary record — no dimensions or private fields. */
export interface AddonExportInput {
  region: RegionCode;
  realmSlug: string;
  name: string;
  displayName?: string;
  overallScore: number;
  grade: Grade;
  confidence: number;
  calculatedAt: string;
  runCount: number;
  baselineDungeonComplete: boolean;
  top25Percent: boolean;
  stale: boolean;
  searchedOnly?: boolean;
  redFlagKeys: string[];
  profileKey?: string;
}

export interface AddonExportEligibilityConfig {
  minRunCount: number;
  minConfidence: number;
  requireBaselineOrTop25: boolean;
  includeSearchedIneligible: boolean;
  excludeStale: boolean;
}

export interface AddonExportContext {
  region: RegionCode;
  seasonSlug: string;
  scoreModelKey: string;
  scoreModelVersion: number;
  generatedAt: string;
  formatVersion: number;
}

export interface AddonCompactRecord {
  score: number;
  gradeCode: number;
  confidenceBucket: number;
  redFlags: number;
  freshnessDays: number;
  profileKey?: string;
}

export interface AddonExportMeta extends AddonExportContext {
  characterCount: number;
  checksum: string;
  shardScheme: string;
}

export interface AddonExportResult {
  meta: AddonExportMeta;
  shards: Map<string, Map<string, AddonCompactRecord>>;
  shardFiles: string[];
}

export const DEFAULT_ELIGIBILITY: AddonExportEligibilityConfig = {
  minRunCount: 20,
  minConfidence: 0.2,
  requireBaselineOrTop25: true,
  includeSearchedIneligible: false,
  excludeStale: true,
};
