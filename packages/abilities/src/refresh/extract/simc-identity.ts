import { isSimcCommitSha } from "../snapshot-identity.js";
import {
  deriveSimcRevisionIdentity,
  type SimcRevisionIdentity,
} from "./simc-revision.js";

export type SimcDataMode = "LIVE" | "PTR" | "UNKNOWN";

export interface SimcBinaryIdentity {
  applicationVersion: string | null;
  wowBuild: string | null;
  gitRevision: string | null;
  dataMode: SimcDataMode;
  executablePath: string;
  rawBanner: string;
  gitBranch?: string | null;
}

export const SIMC_PROVENANCE_ARGS = ["ptr=0", "spell_query=spell.id=1"] as const;

export function parseSimcBinaryBanner(text: string, executablePath: string): SimcBinaryIdentity {
  const combined = text.replace(/\r/g, "");
  const version =
    combined.match(/SimulationCraft\s+([0-9][^\s,]+)/i)?.[1] ??
    combined.match(/simc\s+version\s+([0-9][^\s,]+)/i)?.[1] ??
    null;
  const wowBuild =
    combined.match(/hotfix\s+[^/()\s]+\/(\d+)/i)?.[1] ??
    combined.match(/wow build\s+(\d+)/i)?.[1] ??
    combined.match(/World of Warcraft\s+[\d.]*?(\d{5,})/i)?.[1] ??
    combined.match(/build\s+(\d{5,})/i)?.[1] ??
    null;
  const gitRaw =
    combined.match(/git revision\s+([0-9a-f]{7,40})/i)?.[1] ??
    combined.match(/based on git revision\s+([0-9a-f]{7,40})/i)?.[1] ??
    combined.match(/git build\s+\S+\s+([0-9a-f]{7,40})/i)?.[1] ??
    null;
  const gitBranch = combined.match(/git build\s+(\S+)\s+[0-9a-f]{7,40}/i)?.[1] ?? null;
  let dataMode: SimcDataMode = "UNKNOWN";
  if (/\bPTR\b/i.test(combined) || /\bptr\s*=\s*1\b/i.test(combined)) dataMode = "PTR";
  else if (/\bLive\b/i.test(combined)) dataMode = "LIVE";

  return {
    applicationVersion: version,
    wowBuild,
    gitRevision: gitRaw ? gitRaw.toLowerCase() : null,
    dataMode,
    executablePath,
    rawBanner: combined.slice(0, 4000),
    gitBranch,
  };
}

export interface AssertLiveSimcIdentityResult {
  revision: SimcRevisionIdentity;
}

/**
 * Fail-closed Live identity checks.
 * Revision source of truth is the binary banner; `expectedRevision` is optional CI assertion.
 */
export function assertLiveSimcIdentity(
  identity: SimcBinaryIdentity,
  options: { expectedRevision?: string | null } = {},
): AssertLiveSimcIdentityResult {
  if (identity.dataMode === "PTR") {
    throw Object.assign(new Error("SimC binary reports PTR data; Live extraction refuses PTR"), {
      code: "PTR_DATA_REJECTED",
    });
  }
  if (identity.dataMode === "UNKNOWN") {
    throw Object.assign(new Error("SimC binary did not report Live/PTR data mode; refusing to guess"), {
      code: "DATA_MODE_UNREPORTED",
    });
  }
  const reported = identity.gitRevision;
  if (!reported) {
    throw Object.assign(
      new Error("SimC binary did not report a git revision; refusing unidentified binary"),
      { code: "REVISION_UNREPORTED" },
    );
  }

  const expected = options.expectedRevision?.trim() || null;
  if (expected) {
    const exp = expected.toLowerCase();
    const matches =
      reported === exp ||
      (reported.length >= 7 && reported.length < 40 && exp.startsWith(reported)) ||
      (exp.length >= 7 && exp.length < 40 && reported.startsWith(exp));
    if (!matches) {
      throw Object.assign(
        new Error(`SimC revision mismatch: expected ${exp} vs binary ${reported}`),
        { code: "REVISION_MISMATCH" },
      );
    }
    if (!isSimcCommitSha(exp) && !isSimcCommitSha(reported) && reported.length < 40) {
      // Assertion pin itself must be a full SHA when the binary only prints a prefix,
      // otherwise the assertion cannot prove a unique commit.
      throw Object.assign(
        new Error(
          "Optional --expected-simc-revision must be a 40-character SHA when asserting against a short binary hash",
        ),
        { code: "INVALID_EXPECTED_REVISION" },
      );
    }
  }

  const revision = deriveSimcRevisionIdentity({
    binaryReportedRevision: reported,
    expectedRevision: expected,
  });
  if (revision.revisionPrecision === "UNKNOWN" || !revision.canonicalRevision) {
    throw Object.assign(
      new Error(`SimC binary reported an unusable git revision (${reported})`),
      { code: "REVISION_UNREPORTED" },
    );
  }

  return { revision };
}

export function liveQueryArgs(extra: string[]): string[] {
  if (extra.some((a) => /^ptr\s*=\s*1$/i.test(a))) {
    throw Object.assign(new Error("Live extraction forbids ptr=1"), { code: "PTR_FLAG_FORBIDDEN" });
  }
  return ["ptr=0", ...extra.filter((a) => !/^ptr\s*=/i.test(a))];
}
