import type { IsoDateTime } from "./identity.js";
import type { ProviderName } from "./provider.js";
import type { WclContributionType, WclDataState, WclVisibilityState } from "./warcraftlogs.js";

/** Character-level provider lifecycle for profile/API (Wave 3 MVP). */
export type ProviderLifecycleState =
  | "OK"
  | "STALE"
  | "UNAVAILABLE"
  | "RATE_LIMITED"
  | "PRIVATE_OR_HIDDEN"
  | "NOT_FOUND";

export interface CharacterProviderStateDTO {
  provider: ProviderName;
  state: ProviderLifecycleState;
  detail: string | null;
  lastAttemptAt: IsoDateTime;
  lastSuccessAt: IsoDateTime | null;
  fetchedAt: IsoDateTime | null;
  expiresAt: IsoDateTime | null;
  wclVisibility: WclVisibilityState | null;
  /** Matching / rankings / availability outcome (WCL only). */
  wclDataState?: WclDataState | null;
  warnings: string[];
  /** True when observations from this provider fed the latest score. */
  contributedToScore?: boolean;
  /** How this provider contributed (WCL zone rankings and/or combat facts). */
  contributionTypes?: WclContributionType[];
  /** Public-safe source URL when available. */
  sourceUrl?: string | null;
}

export interface SourceDisagreementDTO {
  field: string;
  primaryProvider: ProviderName;
  primaryValue: unknown;
  otherProvider: ProviderName;
  otherValue: unknown;
  resolution: "PRIMARY_WINS" | "KEEP_BOTH" | "NEWEST_VALID" | "EXCLUDED";
  message: string;
}

export interface ExcludedObservationDTO {
  reason: string;
  provider: ProviderName | "fusion";
  metricKey: string | null;
  detail: unknown;
}
