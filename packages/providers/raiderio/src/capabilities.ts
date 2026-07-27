export type RaiderIoCapabilityState = "available" | "unavailable" | "unknown";

export interface RaiderIoCapabilities {
  characterProfile: RaiderIoCapabilityState;
  seasonCutoffs: RaiderIoCapabilityState;
  staticData: RaiderIoCapabilityState;
  runDetails: RaiderIoCapabilityState;
  periods: RaiderIoCapabilityState;
}

export function createDefaultCapabilities(): RaiderIoCapabilities {
  return {
    characterProfile: "unknown",
    seasonCutoffs: "unknown",
    staticData: "unknown",
    runDetails: "unknown",
    periods: "unknown",
  };
}
