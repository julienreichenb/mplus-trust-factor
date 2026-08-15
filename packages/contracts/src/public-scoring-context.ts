import type { IsoDateTime } from "./identity.js";
import type { KeyContextRegionCode, MetaTier } from "./score-context.js";

export interface PublicScoringContextSeasonDTO {
  id: string;
  slug: string;
  name: string;
  blizzardSeasonId: number | null;
}

export interface PublicScoringContextRevisionDTO {
  id: string;
  version: number;
  publishedAt: IsoDateTime | null;
}

export interface PublicScoringContextClassDTO {
  slug: string;
  name: string;
  specs: Array<{ slug: string; name: string; role: string }>;
}

export interface PublicScoringContextMetaDTO {
  classes: PublicScoringContextClassDTO[];
  assignments: Array<{ classSlug: string; specSlug: string; tier: MetaTier }>;
  tierFactors: Record<MetaTier, number>;
}

export interface PublicScoringContextKeyRowDTO {
  percentileBps: number;
  percentileLabel: string | null;
  factor: number;
  thresholds: Record<KeyContextRegionCode, number | null>;
}

export interface PublicScoringContextRegionSnapshotDTO {
  collectedAt: IsoDateTime;
  source: string;
  sourceVersion: string | null;
}

export interface PublicScoringContextKeyDTO {
  rows: PublicScoringContextKeyRowDTO[];
  unavailable: boolean;
  regionalSnapshots: Record<KeyContextRegionCode, PublicScoringContextRegionSnapshotDTO | null>;
}

/** Published Key + Meta scoring context for public transparency (FAQ artifacts). */
export interface PublicScoringContextDTO {
  available: boolean;
  unavailableReason: string | null;
  scoringSeason: PublicScoringContextSeasonDTO | null;
  revision: PublicScoringContextRevisionDTO | null;
  meta: PublicScoringContextMetaDTO | null;
  key: PublicScoringContextKeyDTO | null;
}
