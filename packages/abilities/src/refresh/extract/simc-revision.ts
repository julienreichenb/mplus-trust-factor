import { isSimcCommitSha } from "../snapshot-identity.js";

/** How precisely the SimC git revision is known for a capture. */
export type SimcRevisionPrecision = "FULL_SHA" | "PREFIX" | "UNKNOWN";

export interface SimcRevisionIdentity {
  /** Exact string reported by the binary banner (lowercase hex), if any. */
  binaryReportedRevision: string | null;
  /** Full 40-char SHA when proven (binary reported it, or expected matched as expansion). */
  resolvedFullRevision: string | null;
  revisionPrecision: SimcRevisionPrecision;
  /**
   * Canonical revision stored on snapshot `simcCommitSha` / `sourceRevision`.
   * Prefer full SHA when proven; otherwise the exact binary-reported value.
   * Never fabricates a 40-char SHA from a short prefix alone.
   */
  canonicalRevision: string;
}

const HEX_PREFIX = /^[0-9a-f]{7,39}$/i;

export function isSimcRevisionPrefix(value: string): boolean {
  return HEX_PREFIX.test(value.trim());
}

/**
 * Derive revision identity from the binary-reported hash.
 * Optional `expectedRevision` is a CI/assertion pin only — never the sole source of truth.
 */
export function deriveSimcRevisionIdentity(input: {
  binaryReportedRevision: string | null;
  expectedRevision?: string | null;
}): SimcRevisionIdentity {
  const reported = input.binaryReportedRevision?.trim().toLowerCase() || null;
  const expected = input.expectedRevision?.trim().toLowerCase() || null;

  if (!reported) {
    return {
      binaryReportedRevision: null,
      resolvedFullRevision: null,
      revisionPrecision: "UNKNOWN",
      canonicalRevision: "",
    };
  }

  if (isSimcCommitSha(reported)) {
    return {
      binaryReportedRevision: reported,
      resolvedFullRevision: reported,
      revisionPrecision: "FULL_SHA",
      canonicalRevision: reported,
    };
  }

  if (isSimcRevisionPrefix(reported)) {
    // Expected full SHA may expand a prefix when it matches — that is proven, not fabricated.
    if (expected && isSimcCommitSha(expected) && expected.startsWith(reported)) {
      return {
        binaryReportedRevision: reported,
        resolvedFullRevision: expected,
        revisionPrecision: "FULL_SHA",
        canonicalRevision: expected,
      };
    }
    return {
      binaryReportedRevision: reported,
      resolvedFullRevision: null,
      revisionPrecision: "PREFIX",
      canonicalRevision: reported,
    };
  }

  return {
    binaryReportedRevision: reported,
    resolvedFullRevision: null,
    revisionPrecision: "UNKNOWN",
    canonicalRevision: reported,
  };
}

/** True when `candidate` is a usable SimC revision identity (full SHA or honest prefix). */
export function isAcceptableSimcSourceRevision(value: string): boolean {
  const v = value.trim();
  return isSimcCommitSha(v) || isSimcRevisionPrefix(v);
}
