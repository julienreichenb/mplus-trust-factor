import type { PublicBoostFlag } from "./types.js";

/**
 * Generic boost-flag resolver.
 * Consumes only public-safe / manifest markers — no dependency on boost-shadow branch.
 */
export interface BoostFlagSource {
  resolve(input: {
    memberId: string;
    suspectedBoostManifest: boolean;
    persistedPublic?: PublicBoostFlag | null;
  }): PublicBoostFlag;
}

export const defaultBoostFlagSource: BoostFlagSource = {
  resolve({ suspectedBoostManifest, persistedPublic }) {
    if (persistedPublic) {
      return {
        suspected: persistedPublic.suspected,
        confidence: persistedPublic.confidence,
        evidenceKeys: [...persistedPublic.evidenceKeys],
        source: persistedPublic.source,
      };
    }
    if (suspectedBoostManifest) {
      return {
        suspected: true,
        confidence: null,
        evidenceKeys: ["manifest.suspectedBoost"],
        source: "manifest",
      };
    }
    return {
      suspected: false,
      confidence: null,
      evidenceKeys: [],
      source: "none",
    };
  },
};
