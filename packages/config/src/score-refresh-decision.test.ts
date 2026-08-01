import { describe, expect, it } from "vitest";
import {
  decideScoreRefresh,
  isWithinFailureBackoff,
  preferRecalculateOnly,
  toAccountTrustStatus,
  DEFAULT_SCORE_TTL_SECONDS,
} from "./score-refresh-decision.js";

const now = Date.parse("2026-07-30T12:00:00.000Z");
const freshAt = new Date(now - 60_000);
const staleAt = new Date(now - (DEFAULT_SCORE_TTL_SECONDS + 1) * 1000);

const base = {
  scoreTtlSeconds: DEFAULT_SCORE_TTL_SECONDS,
  failureBackoffSeconds: 3_600,
  activeJobStatus: null as "QUEUED" | "ACTIVE" | null,
  latestJobStatus: "COMPLETED" as string | null,
  latestJobFinishedAt: freshAt,
  contractReasons: [] as string[],
  nowMs: now,
};

describe("decideScoreRefresh", () => {
  it("ten fresh reads conceptually stay NONE (WITHIN_SCORE_TTL)", () => {
    for (let i = 0; i < 10; i++) {
      const d = decideScoreRefresh({
        ...base,
        hasPublishedScore: true,
        scoreCalculatedAt: freshAt,
      });
      expect(d.action).toBe("NONE");
      expect(d.publicState).toBe("FRESH");
      expect(d.reason).toBe("WITHIN_SCORE_TTL");
      expect(d.profileRefreshStatus).toBe("FRESH");
    }
  });

  it("stale score enqueues exactly once semantically (SCORE_TTL_EXPIRED)", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
    });
    expect(d.action).toBe("ENQUEUE");
    expect(d.publicState).toBe("STALE_USABLE");
    expect(d.reason).toBe("SCORE_TTL_EXPIRED");
    expect(d.profileRefreshStatus).toBe("STALE");
  });

  it("concurrent stale reads reuse an active logical job", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
      activeJobStatus: "QUEUED",
    });
    expect(d.action).toBe("REUSE_ACTIVE_JOB");
    expect(d.publicState).toBe("REFRESHING");
    expect(d.profileRefreshStatus).toBe("REFRESHING");
  });

  it("reading after completion within TTL does not enqueue", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
      latestJobStatus: "COMPLETED",
      latestJobFinishedAt: freshAt,
    });
    expect(d.action).toBe("NONE");
    expect(d.reason).toBe("WITHIN_SCORE_TTL");
  });

  it("failed refresh applies backoff and keeps last score", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
      latestJobStatus: "FAILED",
      latestJobFinishedAt: new Date(now - 60_000),
      latestJobErrorCode: "REFRESH_FAILED",
    });
    expect(d.action).toBe("BACKOFF");
    expect(d.publicState).toBe("FAILED_FALLBACK");
    expect(d.reason).toBe("RECENT_FAILURE");
    expect(d.profileRefreshStatus).toBe("STALE");
    expect(toAccountTrustStatus(d)).toBe("STALE");
  });

  it("contract preflight mismatch is STALE_CONTRACT, not generic BACKOFF", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
      latestJobStatus: "FAILED",
      latestJobFinishedAt: new Date(now - 60_000),
      latestJobErrorCode: "REFRESH_CONTRACT_PREFLIGHT_MISMATCH",
    });
    expect(d.action).toBe("NONE");
    expect(d.action).not.toBe("BACKOFF");
    expect(d.reason).toBe("STALE_CONTRACT");
    expect(d.publicState).toBe("STALE_USABLE");
    expect(d.profileRefreshStatus).toBe("STALE");
    expect(d.warningCodes).toContain("STALE_CONTRACT");
    expect(d.warningCodes).not.toContain("REFRESH_FAILED");
    expect(toAccountTrustStatus(d)).toBe("STALE");
  });

  it("contract preflight missing hash is STALE_CONTRACT without provider backoff", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
      latestJobStatus: "FAILED",
      latestJobFinishedAt: new Date(now - 60_000),
      latestJobErrorCode: "REFRESH_CONTRACT_PREFLIGHT_MISSING_HASH",
    });
    expect(d.action).toBe("NONE");
    expect(d.reason).toBe("STALE_CONTRACT");
    expect(isWithinFailureBackoff("FAILED", new Date(now - 60_000), 3_600, now, "REFRESH_CONTRACT_PREFLIGHT_MISSING_HASH")).toBe(
      false,
    );
  });

  it("stale score remains visible during refresh", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
      activeJobStatus: "ACTIVE",
    });
    expect(d.publicState).toBe("REFRESHING");
    expect(d.profileRefreshStatus).toBe("REFRESHING");
    expect(d.detailedRefreshStatus).toBe("IN_PROGRESS");
  });

  it("model-only mismatch prefers RECALCULATE", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
      contractReasons: ["SCORING_MODEL_CHANGED"],
    });
    expect(d.action).toBe("RECALCULATE");
    expect(d.reason).toBe("MODEL_CONTRACT_CHANGED");
    expect(preferRecalculateOnly(["SCORING_MODEL_CHANGED"])).toBe(true);
  });

  it("adapter mismatch requires full ENQUEUE", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
      contractReasons: ["WCL_ADAPTER_CHANGED"],
    });
    expect(d.action).toBe("ENQUEUE");
    expect(d.reason).toBe("PROVIDER_EVIDENCE_INCOMPATIBLE");
    expect(preferRecalculateOnly(["WCL_ADAPTER_CHANGED"])).toBe(false);
  });

  it("provider-newer-than-score is diagnostic only when otherwise fresh", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
      providerNewerThanScore: true,
    });
    expect(d.action).toBe("NONE");
    expect(d.reason).toBe("PROVIDER_NEWER_DIAGNOSTIC_ONLY");
    expect(d.warningCodes).toContain("SCORE_STALE_VS_PROVIDERS");
    expect(d.profileRefreshStatus).toBe("FRESH");
  });

  it("no published score + eligibility failure is FAILED (not false QUEUED)", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: false,
      scoreCalculatedAt: null,
      latestJobStatus: "FAILED",
      latestJobFinishedAt: new Date(now - 60_000),
      latestJobErrorCode: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
    });
    expect(d.action).toBe("NONE");
    expect(d.publicState).toBe("UNAVAILABLE");
    expect(d.reason).toBe("NOT_REFRESH_ELIGIBLE");
    expect(d.profileRefreshStatus).toBe("FAILED");
    expect(d.detailedRefreshStatus).toBe("FAILED");
    expect(d.warningCodes).toContain("CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN");
  });

  it("no published score enqueues", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: false,
      scoreCalculatedAt: null,
      latestJobStatus: null,
      latestJobFinishedAt: null,
    });
    expect(d.action).toBe("ENQUEUE");
    expect(d.publicState).toBe("NO_SCORE_QUEUED");
    expect(d.profileRefreshStatus).toBe("QUEUED");
  });

  it("maps REFRESHING to account trust status without hiding score", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
      activeJobStatus: "QUEUED",
    });
    expect(toAccountTrustStatus(d)).toBe("REFRESHING");
  });

  it("treats calculatedAt within TTL as fresh regardless of lastPublicRefreshAt age", () => {
    // lastPublicRefreshAt is intentionally absent from the decision input — only calculatedAt matters.
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
    });
    expect(d.action).toBe("NONE");
    expect(d.publicState).toBe("FRESH");
  });

  it("marks calculatedAt older than SCORE_TTL as SCORE_TTL_EXPIRED", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
    });
    expect(d.action).toBe("ENQUEUE");
    expect(d.reason).toBe("SCORE_TTL_EXPIRED");
  });

  it("missing-contract snapshot follows documented full-refresh behaviour", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
      contractReasons: ["CONTRACT_MISSING"],
    });
    expect(d.action).toBe("ENQUEUE");
    expect(d.reason).toBe("PROVIDER_EVIDENCE_INCOMPATIBLE");
    expect(preferRecalculateOnly(["CONTRACT_MISSING"])).toBe(false);
  });
});
