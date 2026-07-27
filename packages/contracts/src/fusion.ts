import type { IsoDateTime } from "./identity.js";
import type { ProviderName } from "./provider.js";
import type { WclVisibilityState } from "./warcraftlogs.js";

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
  warnings: string[];
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
